/**
 * memory/short-term.ts
 *
 * Conversation history stored in Durable Object SQLite.
 *
 * Each DO instance (one per user per agent type) has its own embedded
 * SQLite database. This means:
 * - User A's history is physically isolated from User B's
 * - No KV prefix collisions possible
 * - Single-threaded DO execution means no race conditions on writes
 * - 10 GB SQLite per DO — more than enough for any conversation history
 *
 * Schema:
 *   messages(id, thread_id, role, content, tool_calls_json, timestamp)
 *
 * We keep the last MAX_TURNS turns per thread to bound context window size.
 * Older turns are deleted, not archived — use long-term memory (KV) for
 * facts that need to persist across sessions.
 */

import type { Message } from "../types/index.js";

export const MAX_TURNS = 20; // per thread

export class ShortTermMemory {
  private db: SqlStorage;

  constructor(storage: DurableObjectStorage) {
    this.db = storage.sql;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id          TEXT    PRIMARY KEY,
        thread_id   TEXT    NOT NULL,
        role        TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
        content     TEXT    NOT NULL,
        tool_calls  TEXT,   -- JSON array of ToolCall objects, nullable
        timestamp   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread_time
        ON messages(thread_id, timestamp DESC);
    `);
  }

  /**
   * Append a message to a thread.
   * Automatically trims oldest messages if the thread exceeds MAX_TURNS.
   */
  async append(threadId: string, message: Message): Promise<void> {
    this.db.exec(
      `INSERT INTO messages (id, thread_id, role, content, tool_calls, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      message.id,
      threadId,
      message.role,
      message.content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.timestamp
    );

    // Trim oldest beyond MAX_TURNS
    this.db.exec(
      `DELETE FROM messages
       WHERE thread_id = ?
         AND id NOT IN (
           SELECT id FROM messages
           WHERE thread_id = ?
           ORDER BY timestamp DESC
           LIMIT ?
         )`,
      threadId,
      threadId,
      MAX_TURNS
    );
  }

  /**
   * Retrieve the last N messages for a thread, oldest first (for LLM context).
   */
  getHistory(threadId: string, limit: number = MAX_TURNS): Message[] {
    const rows = this.db
      .exec(
        `SELECT id, role, content, tool_calls, timestamp
         FROM messages
         WHERE thread_id = ?
         ORDER BY timestamp ASC
         LIMIT ?`,
        threadId,
        limit
      )
      .toArray();

    return rows.map((row) => ({
      id: row["id"] as string,
      role: row["role"] as "user" | "assistant",
      content: row["content"] as string,
      timestamp: row["timestamp"] as number,
      toolCalls: row["tool_calls"]
        ? (JSON.parse(row["tool_calls"] as string) as Message["toolCalls"])
        : undefined,
    }));
  }

  /**
   * Count messages in a thread.
   */
  getThreadCount(threadId: string): number {
    const result = this.db
      .exec(
        `SELECT COUNT(*) as cnt FROM messages WHERE thread_id = ?`,
        threadId
      )
      .one();
    return (result?.["cnt"] as number) ?? 0;
  }

  /**
   * List all thread IDs for this user's DO instance.
   */
  listThreads(): string[] {
    const rows = this.db
      .exec(`SELECT DISTINCT thread_id FROM messages ORDER BY thread_id`)
      .toArray();
    return rows.map((r) => r["thread_id"] as string);
  }
}
