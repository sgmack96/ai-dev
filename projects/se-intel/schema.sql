-- schema.sql
-- D1 schema for se-intel-portfolio
-- Run with: npx wrangler d1 execute se-intel-portfolio-db --file=schema.sql

-- ── Audit Log ─────────────────────────────────────────────────────────────────
-- Every agent request is logged here regardless of outcome.
-- Used for:
--   - Usage analytics (who's using what, when)
--   - Eval harness (replay requests against new prompts)
--   - Security audit (who accessed what role-gated tools)
--   - Cost tracking (model + latency per request)
CREATE TABLE IF NOT EXISTS audit_log (
  id                   TEXT    PRIMARY KEY,   -- UUID
  timestamp            INTEGER NOT NULL,      -- Unix ms
  user_id              TEXT    NOT NULL,      -- JWT sub claim
  role                 TEXT    NOT NULL,      -- ae | se | csm | tam | sales_manager
  org_id               TEXT    NOT NULL,
  agent_type           TEXT    NOT NULL,      -- account | enablement
  thread_id            TEXT    NOT NULL,
  message_preview      TEXT,                 -- first 100 chars of user message
  tools_used           TEXT,                 -- JSON array of tool names
  response_latency_ms  INTEGER,
  model                TEXT,
  blocked              INTEGER NOT NULL DEFAULT 0,  -- 0 | 1 (SQLite boolean)
  block_reason         TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_org     ON audit_log(org_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_agent   ON audit_log(agent_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_thread  ON audit_log(thread_id);

-- ── Request Metrics ───────────────────────────────────────────────────────────
-- One row per agent request. Written non-blocking via state.waitUntil().
-- Separate from audit_log: metrics are higher-frequency, write-only from the
-- hot path, and optimised for time-series aggregation (p95, error rate, etc).
-- SLOs evaluated at query time against this table.
CREATE TABLE IF NOT EXISTS request_metrics (
  id               TEXT    PRIMARY KEY,   -- UUID
  timestamp        INTEGER NOT NULL,      -- Unix ms
  org_id           TEXT    NOT NULL,
  user_id          TEXT    NOT NULL,
  agent_type       TEXT    NOT NULL,      -- account | enablement | transcript
  latency_ms       INTEGER NOT NULL,
  kb_chunks_used   INTEGER NOT NULL DEFAULT 0,
  tools_called     TEXT    NOT NULL DEFAULT '[]',  -- JSON array of tool names
  status           TEXT    NOT NULL,      -- success | error | rate_limited
  error_type       TEXT                   -- null | model_error | timeout | auth
);

CREATE INDEX IF NOT EXISTS idx_metrics_org_time   ON request_metrics(org_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_agent_time ON request_metrics(agent_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_status     ON request_metrics(status, timestamp DESC);
