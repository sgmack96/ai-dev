/**
 * agents/base-agent.ts
 *
 * Abstract base class for both AccountIntelAgent and EnablementAgent.
 *
 * Each agent is a Durable Object with:
 * - One instance per user (keyed by userId)
 * - SQLite-backed conversation history (short-term memory)
 * - Role-aware tool dispatch
 * - Workers AI inference (Llama 3.3 70B via @cf/meta/llama-3.3-70b-instruct-fp8-fast)
 * - Structured audit logging to D1
 *
 * The DO pattern means:
 * - All requests for user "alice" go to the SAME DO instance, serialized
 * - No race conditions — the DO is single-threaded
 * - Alice's context never bleeds into Bob's — separate DO = separate SQLite
 * - Idle users cost $0 — DO hibernates when no active connections
 */

import { ShortTermMemory } from "../memory/short-term.js";
import { LongTermMemory } from "../memory/long-term.js";
import { writeMetric } from "../observability/metrics.js";
import type {
  AgentRequest,
  AgentResponse,
  AgentType,
  AuditEvent,
  Env,
  RetrievedChunk,
  ToolCall,
  UserContext,
} from "../types/index.js";

// Workers AI model — fast fp8 quantized 70B, best quality available for free
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export abstract class BaseAgent implements DurableObject {
  protected state: DurableObjectState;
  protected env: Env;
  protected memory: ShortTermMemory;
  protected agentType: AgentType;

  constructor(state: DurableObjectState, env: Env, agentType: AgentType) {
    this.state = state;
    this.env = env;
    this.agentType = agentType;
    this.memory = new ShortTermMemory(state.storage);
  }

  // ── DurableObject fetch handler ───────────────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/chat") {
      return this.handleChat(request);
    }

    if (request.method === "POST" && url.pathname === "/stream") {
      return this.handleStream(request);
    }

    if (request.method === "GET" && url.pathname === "/history") {
      return this.handleHistory(request);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", agentType: this.agentType });
    }

    return new Response("Not found", { status: 404 });
  }

  // ── Chat handler ──────────────────────────────────────────────────────────
  private async handleChat(request: Request): Promise<Response> {
    const start = Date.now();

    let body: AgentRequest;
    try {
      body = (await request.json()) as AgentRequest;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { message, threadId, userContext, debugMode } = body;

    if (!message || !threadId || !userContext) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Load conversation history for this thread
    const history = this.memory.getHistory(threadId);

    // Load long-term memory for context injection
    const ltm = new LongTermMemory(userContext.userId, userContext.orgId, this.env);
    const ltmContext = await ltm.formatForPrompt();

    // Build system prompt (agent-specific, role-aware)
    const systemPrompt = this.buildSystemPrompt(userContext, ltmContext);

    // Convert history to Workers AI message format
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    // Dispatch tools if needed (agent-specific, role-gated)
    const toolCalls: ToolCall[] = [];
    // In debug/eval mode, capture the raw KB chunks the agent retrieved so the
    // response can carry them back for a deterministic faithfulness check.
    const capturedChunks: RetrievedChunk[] | undefined = debugMode ? [] : undefined;
    const toolContext = await this.dispatchTools(message, userContext, toolCalls, capturedChunks);

    // If tools returned context, inject it before the user message
    if (toolContext) {
      messages.splice(messages.length - 1, 0, {
        role: "system",
        content: `[Tool Results]\n${toolContext}`,
      });
    }

    // Call Workers AI
    let responseText: string;
    try {
      const aiResponse = await this.env.AI.run(MODEL, {
        messages,
        max_tokens: 1024,
      } as Parameters<Ai["run"]>[1], {
        gateway: {
          id: "se-intel-gateway",
          metadata: {
            user_id: userContext.userId,
            user_role: userContext.role,
            org_id: userContext.orgId,
            agent_type: this.agentType,
            call_type: "chat",
          },
        },
      });

      // Workers AI returns { response: string } for chat models
      const result = aiResponse as { response?: string };
      responseText = result.response ?? "I was unable to generate a response.";
    } catch (err) {
      console.error("[agent] Workers AI error:", err);
      responseText = "I encountered an error processing your request. Please try again.";
    }

    const latencyMs = Date.now() - start;

    // Persist both turns to short-term memory
    await this.memory.append(threadId, {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: start,
    });

    const assistantMsg =
      toolCalls.length > 0
        ? {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: responseText,
            timestamp: Date.now(),
            toolCalls,
          }
        : {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: responseText,
            timestamp: Date.now(),
          };
    await this.memory.append(threadId, assistantMsg);

    // Use state.waitUntil() so these complete even after the Response is returned.
    // Without this, the DO isolate can be killed before async work finishes.
    this.state.waitUntil(
      this.writeAuditEvent({
        id: crypto.randomUUID(),
        timestamp: start,
        userId: userContext.userId,
        role: userContext.role,
        orgId: userContext.orgId,
        agentType: this.agentType,
        threadId,
        messagePreview: message.slice(0, 100),
        toolsUsed: toolCalls.map((t) => t.toolName),
        responseLatencyMs: latencyMs,
        model: MODEL,
        blocked: false,
      }).catch((err) => console.error("[audit] D1 write error:", err))
    );

    // Write observability metric — non-blocking, never surfaces to user
    this.state.waitUntil(
      writeMetric({
        orgId: userContext.orgId,
        userId: userContext.userId,
        agentType: this.agentType,
        latencyMs,
        kbChunksUsed: capturedChunks?.length ?? toolCalls.filter((t) => t.toolName === "kb_search").length,
        toolsCalled: toolCalls.map((t) => t.toolName),
        status: "success",
      }, this.env).catch((err) => console.error("[metrics] D1 write error:", err))
    );

    // Extract and persist memorable facts — waitUntil keeps the DO alive
    const ltmWriter = new LongTermMemory(userContext.userId, userContext.orgId, this.env);
    this.state.waitUntil(
      ltmWriter
        .extractAndRemember(message, responseText, this.env)
        .catch((err) => console.error("[ltm] extract error:", err))
    );

    const response: AgentResponse = {
      response: responseText,
      threadId,
      model: MODEL,
      latencyMs,
      toolsUsed: toolCalls.map((t) => t.toolName),
    };

    // Only present in debug/eval mode — keeps normal prod payloads lean.
    if (capturedChunks) {
      response.retrievedChunks = capturedChunks;
    }

    return Response.json(response);
  }

  // ── Streaming chat handler ────────────────────────────────────────────────
  // Returns a Server-Sent Events stream. The client receives:
  //   data: {"type":"tools","toolsUsed":["kb_search"]}   (after tool dispatch)
  //   data: {"type":"token","text":"..."}                 (one per token)
  //   data: {"type":"done","latencyMs":14200}             (stream end)
  //   data: {"type":"error","message":"..."}              (on failure)
  //
  // Tools are dispatched synchronously before streaming starts (they need to
  // complete before we know what context to inject into the prompt).
  // Only the LLM generation itself is streamed.
  private async handleStream(request: Request): Promise<Response> {
    const start = Date.now();

    let body: AgentRequest;
    try {
      body = (await request.json()) as AgentRequest;
    } catch {
      return new Response("data: " + JSON.stringify({ type: "error", message: "Invalid JSON" }) + "\n\n", {
        status: 400,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    const { message, threadId, userContext } = body;
    if (!message || !threadId || !userContext) {
      return new Response("data: " + JSON.stringify({ type: "error", message: "Missing required fields" }) + "\n\n", {
        status: 400,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    // Build the prompt (same as handleChat)
    const history = this.memory.getHistory(threadId);
    const ltm = new LongTermMemory(userContext.userId, userContext.orgId, this.env);
    const ltmContext = await ltm.formatForPrompt();
    const systemPrompt = this.buildSystemPrompt(userContext, ltmContext);

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    // Dispatch tools (must complete before streaming — they feed the prompt)
    const toolCalls: ToolCall[] = [];
    const toolContext = await this.dispatchTools(message, userContext, toolCalls);
    if (toolContext) {
      messages.splice(messages.length - 1, 0, {
        role: "system",
        content: `[Tool Results]\n${toolContext}`,
      });
    }

    // Stream response via TransformStream
    // The Worker keeps the outer ReadableStream alive while we push SSE events.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();

    const sse = (obj: Record<string, unknown>) =>
      writer.write(enc.encode("data: " + JSON.stringify(obj) + "\n\n"));

    // Run the streaming LLM call in the background — don't await it here
    // so we can return the Response immediately and start flushing.
    const streamWork = async () => {
      let fullText = "";

      try {
        // Emit tool names immediately so UI can show badges before first token
        if (toolCalls.length > 0) {
          await sse({ type: "tools", toolsUsed: toolCalls.map((t) => t.toolName) });
        }

        // Workers AI streaming — run() with stream:true returns a ReadableStream
        const aiStream = await this.env.AI.run(
          MODEL as "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          {
            messages,
            max_tokens: 1024,
            stream: true,
          },
          {
            gateway: {
              id: "se-intel-gateway",
              metadata: {
                user_id: userContext.userId,
                user_role: userContext.role,
                org_id: userContext.orgId,
                agent_type: this.agentType,
                call_type: "stream",
              },
            },
          }
        ) as ReadableStream;

        const reader = aiStream.getReader();
        const decoder = new TextDecoder();

        // Workers AI streams SSE internally — parse the data: lines
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") break;

            try {
              const parsed = JSON.parse(payload) as {
                response?: string;
                p?: string;
              };
              // Workers AI streaming delivers tokens in .response
              const token = parsed.response ?? "";
              if (token) {
                fullText += token;
                await sse({ type: "token", text: token });
              }
            } catch {
              // Ignore malformed SSE lines
            }
          }
        }
      } catch (err) {
        console.error("[stream] Workers AI error:", err);
        await sse({ type: "error", message: "Generation failed. Please retry." });
        await writer.close();
        return;
      }

      const latencyMs = Date.now() - start;

      // Send done event with metadata
      await sse({ type: "done", latencyMs, toolsUsed: toolCalls.map((t) => t.toolName) });
      await writer.close();

      // Persist to memory + audit log (fire and forget — stream is already closed)
      this.memory.append(threadId, {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        timestamp: start,
      }).catch(() => {});

      const assistantMsg = toolCalls.length > 0
        ? { id: crypto.randomUUID(), role: "assistant" as const, content: fullText, timestamp: Date.now(), toolCalls }
        : { id: crypto.randomUUID(), role: "assistant" as const, content: fullText, timestamp: Date.now() };
      this.memory.append(threadId, assistantMsg).catch(() => {});

      this.state.waitUntil(
        this.writeAuditEvent({
          id: crypto.randomUUID(),
          timestamp: start,
          userId: userContext.userId,
          role: userContext.role,
          orgId: userContext.orgId,
          agentType: this.agentType,
          threadId,
          messagePreview: message.slice(0, 100),
          toolsUsed: toolCalls.map((t) => t.toolName),
          responseLatencyMs: latencyMs,
          model: MODEL,
          blocked: false,
        }).catch(() => {})
      );

      // Write observability metric — non-blocking
      this.state.waitUntil(
        writeMetric({
          orgId: userContext.orgId,
          userId: userContext.userId,
          agentType: this.agentType,
          latencyMs,
          kbChunksUsed: toolCalls.filter((t) => t.toolName === "kb_search").length,
          toolsCalled: toolCalls.map((t) => t.toolName),
          status: "success",
        }, this.env).catch(() => {})
      );

      // Extract and persist memorable facts — waitUntil keeps the DO alive
      const ltmWriter = new LongTermMemory(userContext.userId, userContext.orgId, this.env);
      this.state.waitUntil(
        ltmWriter
          .extractAndRemember(message, fullText, this.env)
          .catch(() => {})
      );
    };

    // Start streaming work — intentionally not awaited
    streamWork();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // disable nginx buffering if behind a proxy
      },
    });
  }

  // ── History handler ───────────────────────────────────────────────────────
  private handleHistory(request: Request): Response {
    const url = new URL(request.url);
    const threadId = url.searchParams.get("threadId");
    if (!threadId) {
      return Response.json({ error: "threadId required" }, { status: 400 });
    }
    const history = this.memory.getHistory(threadId);
    return Response.json({ threadId, messages: history, count: history.length });
  }

  // ── Audit write ───────────────────────────────────────────────────────────
  private async writeAuditEvent(event: AuditEvent): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO audit_log
         (id, timestamp, user_id, role, org_id, agent_type, thread_id,
          message_preview, tools_used, response_latency_ms, model, blocked, block_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      event.id,
      event.timestamp,
      event.userId,
      event.role,
      event.orgId,
      event.agentType,
      event.threadId,
      event.messagePreview,
      JSON.stringify(event.toolsUsed),
      event.responseLatencyMs,
      event.model,
      event.blocked ? 1 : 0,
      event.blockReason ?? null
    ).run();
  }

  // ── Abstract methods (implemented by each agent subclass) ─────────────────

  /**
   * Build the system prompt for this agent type.
   * Role and long-term memory context are injected here.
   */
  protected abstract buildSystemPrompt(
    userContext: UserContext,
    ltmContext: string
  ): string;

  /**
   * Dispatch tools based on the user message and role.
   * Returns a formatted string of tool results to inject into context,
   * and populates the toolCalls array for audit logging.
   *
   * IMPORTANT: Each tool must verify role permissions before executing.
   * Do not rely solely on the tool registry — enforce at execution time.
   *
   * @param capturedChunks - optional. When provided (debug/eval mode), the agent
   *   pushes the raw KB chunks it retrieved into this array so the caller can run
   *   a deterministic faithfulness check. KB chunks only — web/news are not captured.
   */
  protected abstract dispatchTools(
    message: string,
    userContext: UserContext,
    toolCalls: ToolCall[],
    capturedChunks?: RetrievedChunk[]
  ): Promise<string | null>;
}
