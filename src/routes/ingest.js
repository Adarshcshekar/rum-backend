/**
 * routes/ingest.js
 * POST /ingest — receives event batches from the SDK.
 *
 * Validates the payload, processes events, returns a summary.
 */

import { Router } from "express";
import { processBatch } from "../services/eventProcessor.js";

const router = Router();

const MAX_EVENTS_PER_BATCH = 100;

router.post("/", async (req, res) => {
  const { events } = req.body;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!events || !Array.isArray(events)) {
    return res.status(400).json({
      error: "Invalid payload — expected { events: [] }",
    });
  }

  if (events.length === 0) {
    return res.status(200).json({ received: 0, processed: 0 });
  }

  if (events.length > MAX_EVENTS_PER_BATCH) {
    return res.status(413).json({
      error: `Batch too large — max ${MAX_EVENTS_PER_BATCH} events per request`,
    });
  }

  // Basic event shape validation
  const invalid = events.filter(
    (e) => !e.type || !e.appId || !e.sessionId
  );
  if (invalid.length > 0) {
    return res.status(400).json({
      error: `${invalid.length} events missing required fields (type, appId, sessionId)`,
    });
  }

  // ── Process ─────────────────────────────────────────────────────────────────
  try {
    const { processed, skipped } = await processBatch(events);

    return res.status(200).json({
      received: events.length,
      processed,
      skipped,
    });
  } catch (err) {
    console.error("[ingest] Batch processing failed:", err.message);
    return res.status(500).json({ error: "Failed to process events" });
  }
});

export default router;
