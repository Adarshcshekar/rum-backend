/**
 * db/migrate.js
 * Creates all RUM tables in PostgreSQL.
 * Run with: npm run db:migrate
 *
 * Schema design decisions:
 * - One `events` table stores ALL event types (single-table design)
 *   → Simple to query, easy to add new event types, great for time-series
 * - Typed sub-tables (api_calls, js_errors, performance) for structured queries
 *   → Dashboard can query typed data efficiently with proper indexes
 * - JSONB `data` column on events for flexible metadata
 *   → Future-proof, no migrations needed when SDK adds new fields
 */

import { query, testConnection } from "./pool.js";
import dotenv from "dotenv";

dotenv.config();

const migrations = [

  // ─── Core events table ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS events (
    id            BIGSERIAL PRIMARY KEY,
    type          VARCHAR(50)  NOT NULL,
    app_id        VARCHAR(100) NOT NULL,
    session_id    VARCHAR(100) NOT NULL,
    device_id     VARCHAR(100),
    user_id       VARCHAR(255),
    timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    session_age   INTEGER,
    data          JSONB        NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  // ─── Indexes on events ─────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_events_type        ON events (type)`,
  `CREATE INDEX IF NOT EXISTS idx_events_app_id      ON events (app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_session_id  ON events (session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_user_id     ON events (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_timestamp   ON events (timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_data        ON events USING GIN (data)`,

  // ─── Sessions (derived from events, pre-aggregated for dashboard) ──────────
  `CREATE TABLE IF NOT EXISTS sessions (
    id            VARCHAR(100) PRIMARY KEY,
    app_id        VARCHAR(100) NOT NULL,
    device_id     VARCHAR(100),
    user_id       VARCHAR(255),
    user_meta     JSONB        NOT NULL DEFAULT '{}',
    started_at    TIMESTAMPTZ  NOT NULL,
    last_seen_at  TIMESTAMPTZ  NOT NULL,
    duration_ms   INTEGER,
    page_views    INTEGER      NOT NULL DEFAULT 0,
    error_count   INTEGER      NOT NULL DEFAULT 0,
    click_count   INTEGER      NOT NULL DEFAULT 0,
    api_call_count INTEGER     NOT NULL DEFAULT 0,
    entry_page    VARCHAR(500),
    exit_page     VARCHAR(500),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sessions_app_id    ON sessions (app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_id   ON sessions (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_started   ON sessions (started_at DESC)`,

  // ─── API calls (structured for fast filtering + grouping) ──────────────────
  `CREATE TABLE IF NOT EXISTS api_calls (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT       REFERENCES events(id) ON DELETE CASCADE,
    session_id    VARCHAR(100) NOT NULL,
    app_id        VARCHAR(100) NOT NULL,
    user_id       VARCHAR(255),
    url           VARCHAR(500) NOT NULL,
    method        VARCHAR(10)  NOT NULL,
    status        INTEGER,
    ok            BOOLEAN,
    duration_ms   INTEGER,
    slow          BOOLEAN      NOT NULL DEFAULT FALSE,
    error         TEXT,
    page          VARCHAR(500),
    request_size  INTEGER,
    response_size INTEGER,
    timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_api_calls_url       ON api_calls (url)`,
  `CREATE INDEX IF NOT EXISTS idx_api_calls_status    ON api_calls (status)`,
  `CREATE INDEX IF NOT EXISTS idx_api_calls_slow      ON api_calls (slow) WHERE slow = TRUE`,
  `CREATE INDEX IF NOT EXISTS idx_api_calls_timestamp ON api_calls (timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_api_calls_app_id    ON api_calls (app_id)`,

  // ─── JS Errors ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS js_errors (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT       REFERENCES events(id) ON DELETE CASCADE,
    session_id    VARCHAR(100) NOT NULL,
    app_id        VARCHAR(100) NOT NULL,
    user_id       VARCHAR(255),
    message       TEXT         NOT NULL,
    name          VARCHAR(100),
    stack         TEXT,
    source        VARCHAR(50),
    file          TEXT,
    line          INTEGER,
    col           INTEGER,
    page          VARCHAR(500),
    context       JSONB        NOT NULL DEFAULT '{}',
    timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_js_errors_app_id   ON js_errors (app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_js_errors_message  ON js_errors (message)`,
  `CREATE INDEX IF NOT EXISTS idx_js_errors_timestamp ON js_errors (timestamp DESC)`,

  // ─── Performance metrics ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS performance_metrics (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT       REFERENCES events(id) ON DELETE CASCADE,
    session_id    VARCHAR(100) NOT NULL,
    app_id        VARCHAR(100) NOT NULL,
    metric        VARCHAR(50)  NOT NULL,
    value         NUMERIC,
    rating        VARCHAR(20),
    page          VARCHAR(500),
    timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_perf_app_id    ON performance_metrics (app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_perf_metric    ON performance_metrics (metric)`,
  `CREATE INDEX IF NOT EXISTS idx_perf_timestamp ON performance_metrics (timestamp DESC)`,

  // ─── Page views ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS page_views (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT       REFERENCES events(id) ON DELETE CASCADE,
    session_id    VARCHAR(100) NOT NULL,
    app_id        VARCHAR(100) NOT NULL,
    user_id       VARCHAR(255),
    page          VARCHAR(500) NOT NULL,
    title         TEXT,
    referrer      TEXT,
    time_on_page  INTEGER,
    timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_page_views_app_id    ON page_views (app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_page_views_page      ON page_views (page)`,
  `CREATE INDEX IF NOT EXISTS idx_page_views_timestamp ON page_views (timestamp DESC)`,

];

async function migrate() {
  console.log("[migrate] Connecting to database...");
  const connected = await testConnection();
  if (!connected) process.exit(1);

  console.log(`[migrate] Running ${migrations.length} migrations...`);

  for (let i = 0; i < migrations.length; i++) {
    try {
      await query(migrations[i]);
      process.stdout.write(".");
    } catch (err) {
      console.error(`\n[migrate] Failed on migration ${i + 1}:`, err.message);
      process.exit(1);
    }
  }

  console.log("\n[migrate] ✅ All tables created successfully.");
  process.exit(0);
}

migrate();
