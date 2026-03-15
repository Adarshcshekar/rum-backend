/**
 * routes/events.js
 * Query endpoints for the analytics dashboard.
 *
 * GET /events          — raw events with filters
 * GET /events/sessions — session list with summaries
 * GET /events/errors   — JS errors grouped + raw
 * GET /events/api      — API calls with performance stats
 * GET /events/performance — Web vitals per page
 * GET /events/overview — dashboard summary stats
 */

import { Router } from "express";
import { query } from "../db/pool.js";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parses common query filters from request.
 */
function parseFilters(q) {
  return {
    appId:     q.appId     || null,
    sessionId: q.sessionId || null,
    userId:    q.userId    || null,
    from:      q.from      || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    to:        q.to        || new Date().toISOString(),
    page:      q.page      || null,
    limit:     Math.min(parseInt(q.limit || "100"), 500),
    offset:    parseInt(q.offset || "0"),
  };
}

// ─── Overview (dashboard home stats) ─────────────────────────────────────────

router.get("/overview", async (req, res) => {
  const { appId, from, to } = parseFilters(req.query);

  try {
    const [sessions, errors, apiCalls, pageViews, vitals] = await Promise.all([
      // Total sessions
      query(
        `SELECT COUNT(*) as total,
                COUNT(DISTINCT user_id) as unique_users,
                AVG(duration_ms) as avg_duration
         FROM sessions
         WHERE ($1::text IS NULL OR app_id = $1)
           AND started_at BETWEEN $2 AND $3`,
        [appId, from, to]
      ),

      // Error count
      query(
        `SELECT COUNT(*) as total,
                COUNT(DISTINCT session_id) as affected_sessions
         FROM js_errors
         WHERE ($1::text IS NULL OR app_id = $1)
           AND timestamp BETWEEN $2 AND $3`,
        [appId, from, to]
      ),

      // API call stats
      query(
        `SELECT COUNT(*) as total,
                AVG(duration_ms) as avg_duration,
                COUNT(*) FILTER (WHERE slow = true) as slow_count,
                COUNT(*) FILTER (WHERE ok = false) as error_count
         FROM api_calls
         WHERE ($1::text IS NULL OR app_id = $1)
           AND timestamp BETWEEN $2 AND $3`,
        [appId, from, to]
      ),

      // Page views
      query(
        `SELECT COUNT(*) as total,
                COUNT(DISTINCT page) as unique_pages
         FROM page_views
         WHERE ($1::text IS NULL OR app_id = $1)
           AND timestamp BETWEEN $2 AND $3`,
        [appId, from, to]
      ),

      // Core web vitals averages
      query(
        `SELECT metric,
                AVG(value) as avg_value,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY value) as p75
         FROM performance_metrics
         WHERE ($1::text IS NULL OR app_id = $1)
           AND timestamp BETWEEN $2 AND $3
           AND metric IN ('FCP','LCP','FID','CLS')
         GROUP BY metric`,
        [appId, from, to]
      ),
    ]);

    res.json({
      sessions:  sessions.rows[0],
      errors:    errors.rows[0],
      apiCalls:  apiCalls.rows[0],
      pageViews: pageViews.rows[0],
      vitals:    vitals.rows,
    });
  } catch (err) {
    console.error("[events/overview]", err.message);
    res.status(500).json({ error: "Failed to fetch overview" });
  }
});

// ─── Raw Events ───────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const f = parseFilters(req.query);
  const { type } = req.query;

  try {
    const result = await query(
      `SELECT * FROM events
       WHERE ($1::text IS NULL OR app_id = $1)
         AND ($2::text IS NULL OR session_id = $2)
         AND ($3::text IS NULL OR user_id = $3)
         AND ($4::text IS NULL OR type = $4)
         AND timestamp BETWEEN $5 AND $6
       ORDER BY timestamp DESC
       LIMIT $7 OFFSET $8`,
      [f.appId, f.sessionId, f.userId, type || null, f.from, f.to, f.limit, f.offset]
    );
    res.json({ events: result.rows, count: result.rowCount });
  } catch (err) {
    console.error("[events]", err.message);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

router.get("/sessions", async (req, res) => {
  const f = parseFilters(req.query);

  try {
    const result = await query(
      `SELECT * FROM sessions
       WHERE ($1::text IS NULL OR app_id = $1)
         AND ($2::text IS NULL OR user_id = $2)
         AND started_at BETWEEN $3 AND $4
       ORDER BY started_at DESC
       LIMIT $5 OFFSET $6`,
      [f.appId, f.userId, f.from, f.to, f.limit, f.offset]
    );
    res.json({ sessions: result.rows, count: result.rowCount });
  } catch (err) {
    console.error("[events/sessions]", err.message);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// ─── JS Errors ────────────────────────────────────────────────────────────────

router.get("/errors", async (req, res) => {
  const f = parseFilters(req.query);

  try {
    const [list, grouped] = await Promise.all([
      // Raw errors
      query(
        `SELECT * FROM js_errors
         WHERE ($1::text IS NULL OR app_id = $1)
           AND ($2::text IS NULL OR session_id = $2)
           AND ($3::text IS NULL OR user_id = $3)
           AND timestamp BETWEEN $4 AND $5
         ORDER BY timestamp DESC
         LIMIT $6 OFFSET $7`,
        [f.appId, f.sessionId, f.userId, f.from, f.to, f.limit, f.offset]
      ),

      // Grouped by message (for error frequency chart)
      query(
        `SELECT message, name, COUNT(*) as occurrences,
                COUNT(DISTINCT session_id) as affected_sessions,
                MAX(timestamp) as last_seen
         FROM js_errors
         WHERE ($1::text IS NULL OR app_id = $1)
           AND timestamp BETWEEN $2 AND $3
         GROUP BY message, name
         ORDER BY occurrences DESC
         LIMIT 20`,
        [f.appId, f.from, f.to]
      ),
    ]);

    res.json({
      errors:  list.rows,
      grouped: grouped.rows,
      count:   list.rowCount,
    });
  } catch (err) {
    console.error("[events/errors]", err.message);
    res.status(500).json({ error: "Failed to fetch errors" });
  }
});

// ─── API Calls ────────────────────────────────────────────────────────────────

router.get("/api-calls", async (req, res) => {
  const f = parseFilters(req.query);
  const { url, method, slow, status } = req.query;

  try {
    const [list, byEndpoint] = await Promise.all([
      // Raw calls
      query(
        `SELECT * FROM api_calls
         WHERE ($1::text IS NULL OR app_id = $1)
           AND ($2::text IS NULL OR session_id = $2)
           AND ($3::text IS NULL OR url ILIKE '%' || $3 || '%')
           AND ($4::text IS NULL OR method = $4)
           AND ($5::boolean IS NULL OR slow = $5)
           AND ($6::int IS NULL OR status = $6)
           AND timestamp BETWEEN $7 AND $8
         ORDER BY timestamp DESC
         LIMIT $9 OFFSET $10`,
        [
          f.appId, f.sessionId,
          url || null, method || null,
          slow != null ? slow === "true" : null,
          status ? parseInt(status) : null,
          f.from, f.to, f.limit, f.offset,
        ]
      ),

      // Grouped by endpoint (for performance table)
      query(
        `SELECT url, method,
                COUNT(*) as call_count,
                AVG(duration_ms) as avg_ms,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_ms,
                MAX(duration_ms) as max_ms,
                COUNT(*) FILTER (WHERE ok = false) as error_count,
                COUNT(*) FILTER (WHERE slow = true) as slow_count
         FROM api_calls
         WHERE ($1::text IS NULL OR app_id = $1)
           AND timestamp BETWEEN $2 AND $3
         GROUP BY url, method
         ORDER BY call_count DESC
         LIMIT 50`,
        [f.appId, f.from, f.to]
      ),
    ]);

    res.json({
      calls:       list.rows,
      byEndpoint:  byEndpoint.rows,
      count:       list.rowCount,
    });
  } catch (err) {
    console.error("[events/api-calls]", err.message);
    res.status(500).json({ error: "Failed to fetch API calls" });
  }
});

// ─── Performance ─────────────────────────────────────────────────────────────

router.get("/performance", async (req, res) => {
  const f = parseFilters(req.query);

  try {
    const [vitals, byPage, timeline] = await Promise.all([
      // Overall vitals summary
      query(
        `SELECT metric,
                AVG(value)::numeric(10,2) as avg,
                PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY value)::numeric(10,2) as p50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY value)::numeric(10,2) as p75,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)::numeric(10,2) as p95,
                COUNT(*) as samples,
                COUNT(*) FILTER (WHERE rating = 'good') as good,
                COUNT(*) FILTER (WHERE rating = 'needs-improvement') as needs_improvement,
                COUNT(*) FILTER (WHERE rating = 'poor') as poor
         FROM performance_metrics
         WHERE ($1::text IS NULL OR app_id = $1)
           AND timestamp BETWEEN $2 AND $3
         GROUP BY metric`,
        [f.appId, f.from, f.to]
      ),

      // Vitals by page
      query(
        `SELECT page, metric,
                AVG(value)::numeric(10,2) as avg_value,
                COUNT(*) as samples
         FROM performance_metrics
         WHERE ($1::text IS NULL OR app_id = $1)
           AND ($2::text IS NULL OR page = $2)
           AND timestamp BETWEEN $3 AND $4
         GROUP BY page, metric
         ORDER BY page, metric`,
        [f.appId, f.page, f.from, f.to]
      ),

      // LCP timeline (for trend chart)
      query(
        `SELECT DATE_TRUNC('hour', timestamp) as hour,
                AVG(value)::numeric(10,2) as avg_lcp
         FROM performance_metrics
         WHERE ($1::text IS NULL OR app_id = $1)
           AND metric = 'LCP'
           AND timestamp BETWEEN $2 AND $3
         GROUP BY hour
         ORDER BY hour`,
        [f.appId, f.from, f.to]
      ),
    ]);

    res.json({
      vitals:   vitals.rows,
      byPage:   byPage.rows,
      timeline: timeline.rows,
    });
  } catch (err) {
    console.error("[events/performance]", err.message);
    res.status(500).json({ error: "Failed to fetch performance" });
  }
});

// ─── Page Views ───────────────────────────────────────────────────────────────

router.get("/page-views", async (req, res) => {
  const f = parseFilters(req.query);

  try {
    const result = await query(
      `SELECT page,
              COUNT(*) as views,
              COUNT(DISTINCT session_id) as unique_sessions,
              AVG(time_on_page) as avg_time_on_page
       FROM page_views
       WHERE ($1::text IS NULL OR app_id = $1)
         AND timestamp BETWEEN $2 AND $3
       GROUP BY page
       ORDER BY views DESC
       LIMIT $4`,
      [f.appId, f.from, f.to, f.limit]
    );
    res.json({ pages: result.rows });
  } catch (err) {
    console.error("[events/page-views]", err.message);
    res.status(500).json({ error: "Failed to fetch page views" });
  }
});

export default router;
