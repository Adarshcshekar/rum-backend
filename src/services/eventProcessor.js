/**
 * services/eventProcessor.js
 * Processes incoming event batches — inserts into events table
 * and routes typed events into their dedicated tables.
 *
 * All inserts are done in a single transaction per batch for atomicity.
 */

import { transaction } from "../db/pool.js";

/**
 * Processes a batch of events from the SDK.
 * @param {Array} events - Array of event objects
 * @returns {Object} - { processed, skipped }
 */
export async function processBatch(events) {
  if (!events?.length) return { processed: 0, skipped: 0 };

  let processed = 0;
  let skipped = 0;

  await transaction(async (client) => {
    for (const event of events) {
      try {
        // 1. Insert into the main events table
        const eventResult = await client.query(
          `INSERT INTO events
            (type, app_id, session_id, device_id, user_id, timestamp, session_age, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            event.type,
            event.appId,
            event.sessionId,
            event.deviceId || null,
            event.userId || null,
            event.timestamp || new Date().toISOString(),
            event.sessionAge || null,
            JSON.stringify(event.data || {}),
          ]
        );

        const eventId = eventResult.rows[0].id;

        // 2. Upsert session summary
        await upsertSession(client, event);

        // 3. Route to typed sub-table
        await routeToSubTable(client, eventId, event);

        processed++;
      } catch (err) {
        console.error("[processor] Failed to process event:", err.message, event?.type);
        skipped++;
      }
    }
  });

  return { processed, skipped };
}

// ─── Session Upsert ──────────────────────────────────────────────────────────

async function upsertSession(client, event) {
  const isPageView   = event.type === "page_view";
  const isError      = event.type === "js_error";
  const isClick      = event.type === "interaction" && event.data?.action === "click";
  const isApiCall    = event.type === "api_call";
  const isIdentify   = event.type === "identify";

  const userMeta = isIdentify
    ? JSON.stringify(event.data || {})
    : null;

  await client.query(
    `INSERT INTO sessions
      (id, app_id, device_id, user_id, user_meta, started_at, last_seen_at,
       page_views, error_count, click_count, api_call_count, entry_page)
     VALUES
      ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       last_seen_at   = EXCLUDED.last_seen_at,
       duration_ms    = EXTRACT(EPOCH FROM (EXCLUDED.last_seen_at - sessions.started_at)) * 1000,
       user_id        = COALESCE(EXCLUDED.user_id, sessions.user_id),
       user_meta      = CASE WHEN $5 IS NOT NULL THEN EXCLUDED.user_meta ELSE sessions.user_meta END,
       page_views     = sessions.page_views     + EXCLUDED.page_views,
       error_count    = sessions.error_count    + EXCLUDED.error_count,
       click_count    = sessions.click_count    + EXCLUDED.click_count,
       api_call_count = sessions.api_call_count + EXCLUDED.api_call_count,
       exit_page      = CASE WHEN $12 THEN EXCLUDED.entry_page ELSE sessions.exit_page END`,
    [
      event.sessionId,
      event.appId,
      event.deviceId || null,
      event.userId || null,
      userMeta || "{}",
      event.timestamp || new Date().toISOString(),
      isPageView ? 1 : 0,
      isError    ? 1 : 0,
      isClick    ? 1 : 0,
      isApiCall  ? 1 : 0,
      event.data?.page || null,   // entry_page (only set on insert)
      isPageView,                 // update exit_page on page views
    ]
  );
}

// ─── Sub-table Router ────────────────────────────────────────────────────────

async function routeToSubTable(client, eventId, event) {
  const { type, sessionId, appId, userId, timestamp, data = {} } = event;

  switch (type) {
    case "api_call":
      await client.query(
        `INSERT INTO api_calls
          (event_id, session_id, app_id, user_id, url, method, status, ok,
           duration_ms, slow, error, page, request_size, response_size, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          eventId, sessionId, appId, userId || null,
          data.url, data.method, data.status || null,
          data.ok ?? null, data.duration || null,
          data.slow || false, data.error || null,
          data.page || null, data.requestSize || null,
          data.responseSize || null, timestamp,
        ]
      );
      break;

    case "js_error":
      await client.query(
        `INSERT INTO js_errors
          (event_id, session_id, app_id, user_id, message, name, stack,
           source, file, line, col, page, context, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          eventId, sessionId, appId, userId || null,
          data.message || "Unknown error", data.name || null,
          data.stack || null, data.source || null,
          data.file || null, data.line || null,
          data.col || null, data.page || null,
          JSON.stringify(data.context || {}), timestamp,
        ]
      );
      break;

    case "performance":
      await client.query(
        `INSERT INTO performance_metrics
          (event_id, session_id, app_id, metric, value, rating, page, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          eventId, sessionId, appId,
          data.metric, data.value ?? null,
          data.rating || null, data.page || null, timestamp,
        ]
      );
      break;

    case "page_view":
      await client.query(
        `INSERT INTO page_views
          (event_id, session_id, app_id, user_id, page, title, referrer, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          eventId, sessionId, appId, userId || null,
          data.page, data.title || null,
          data.referrer || null, timestamp,
        ]
      );
      break;

    // custom, interaction, identify, user_reset — stored in events only
    default:
      break;
  }
}
