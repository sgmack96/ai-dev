/**
 * AI Gateway Dynamic Routing — Worker Example
 *
 * Shows how an application integrates with the "engineering" Dynamic Route.
 * The Worker accepts a POST with { workflow, prompt } and routes it through
 * AI Gateway with the appropriate metadata. The gateway handles model selection.
 *
 * Supported workflows:
 *   code_review     → gpt-4.1       (frontier reasoning)
 *   meeting_prep    → gpt-4o-mini   (cheap summarization)
 *   incident_triage → gpt-4.1       (accuracy matters)
 *   slack_summary   → llama-3.1-8b  (Workers AI, nearly free)
 *   [anything else] → gpt-4o-mini   (default fallback)
 *
 * The routing logic lives entirely in AI Gateway — this Worker
 * only needs to attach metadata and call dynamic/engineering.
 */

export interface Env {
  // Secrets — set with: wrangler secret put CF_AIG_TOKEN
  CF_AIG_TOKEN:  string;
  ACCOUNT_ID:    string;
  GATEWAY_ID:    string;
}

interface RequestBody {
  workflow: string;
  prompt:   string;
  userId?:  string;
  team?:    string;
}

interface RoutingResult {
  workflow:   string;
  model:      string;
  provider:   string;
  response:   string;
  cached:     boolean;
  latencyMs:  number;
}

// Valid workflow types — anything else routes to default (gpt-4o-mini)
const VALID_WORKFLOWS = [
  'code_review',
  'meeting_prep',
  'incident_triage',
  'slack_summary',
] as const;

type Workflow = typeof VALID_WORKFLOWS[number];

function isValidWorkflow(w: string): w is Workflow {
  return VALID_WORKFLOWS.includes(w as Workflow);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS for local testing
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin':  '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'POST only' }, { status: 405 });
    }

    // Parse request body
    let body: RequestBody;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { workflow, prompt, userId = 'anonymous', team = 'engineering' } = body;

    if (!workflow || !prompt) {
      return Response.json(
        { error: 'Required fields: workflow, prompt' },
        { status: 400 }
      );
    }

    // Warn on unknown workflow — gateway will use default fallback
    if (!isValidWorkflow(workflow)) {
      console.warn(`Unknown workflow "${workflow}" — gateway will use default route`);
    }

    // Build the AI Gateway request
    const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/compat/chat/completions`;

    // This is the only metadata the application needs to provide.
    // All routing decisions happen in the gateway based on these tags.
    const metadata = {
      team,
      workflow,
      userId,
    };

    const startTime = Date.now();

    let gatewayResponse: Response;
    try {
      gatewayResponse = await fetch(gatewayUrl, {
        method:  'POST',
        headers: {
          'Content-Type':          'application/json',
          'cf-aig-authorization':  `Bearer ${env.CF_AIG_TOKEN}`,
          'cf-aig-metadata':       JSON.stringify(metadata),
        },
        body: JSON.stringify({
          model:    'dynamic/engineering',   // Route name — not a real model
          messages: [
            { role: 'user', content: prompt }
          ],
          max_tokens: 500,
        }),
      });
    } catch (err) {
      return Response.json(
        { error: 'AI Gateway request failed', detail: String(err) },
        { status: 502 }
      );
    }

    const latencyMs = Date.now() - startTime;

    if (!gatewayResponse.ok) {
      const errorText = await gatewayResponse.text();
      return Response.json(
        { error: 'Gateway returned error', status: gatewayResponse.status, detail: errorText },
        { status: gatewayResponse.status }
      );
    }

    // Extract routing metadata from response headers
    // These tell you which model and provider actually served the request
    const modelUsed    = gatewayResponse.headers.get('cf-aig-model')    ?? 'unknown';
    const providerUsed = gatewayResponse.headers.get('cf-aig-provider') ?? 'unknown';
    const wasCached    = gatewayResponse.headers.get('cf-aig-cache-status') === 'HIT';

    // Parse the model response
    const completion = await gatewayResponse.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const responseText = completion.choices?.[0]?.message?.content ?? '';

    const result: RoutingResult = {
      workflow,
      model:     modelUsed,
      provider:  providerUsed,
      response:  responseText,
      cached:    wasCached,
      latencyMs,
    };

    return Response.json(result, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  },
};
