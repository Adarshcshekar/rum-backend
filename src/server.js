/**
 * server.js
 * RUM Backend — Express server entry point.
 *
 * Endpoints:
 *   POST /ingest              ← SDK sends events here
 *   GET  /events              ← raw events with filters
 *   GET  /events/overview     ← dashboard summary stats
 *   GET  /events/sessions     ← session list
 *   GET  /events/errors       ← JS errors
 *   GET  /events/api-calls    ← network calls
 *   GET  /events/performance  ← web vitals
 *   GET  /events/page-views   ← page traffic
 *   GET  /health              ← health check
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import dotenv from "dotenv";

import { testConnection } from "./db/pool.js";
import ingestRouter from "./routes/ingest.js";
import eventsRouter from "./routes/events.js";
import { requestLogger, errorHandler, notFound } from "./middleware/index.js";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "4000");

// ─── Security & Parsing ──────────────────────────────────────────────────────

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "1mb" })); // batches can be large

// CORS — allow SDK origins and dashboard
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman, sendBeacon)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-RUM-App-Id"],
  }),
);

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(requestLogger);

// ─── Routes ──────────────────────────────────────────────────────────────────

// Health check — used by Docker/k8s probes
app.get("/health", async (req, res) => {
  const dbOk = await testConnection().catch(() => false);
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "degraded",
    db: dbOk ? "connected" : "unreachable",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// SDK sends events here
app.use("/ingest", ingestRouter);

// Dashboard reads from here
app.use("/events", eventsRouter);

// ─── Error Handling ──────────────────────────────────────────────────────────

app.use(notFound);
app.use(errorHandler);

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function start() {
  console.log("[server] Starting RUM backend...");

  const dbOk = await testConnection();
  if (!dbOk) {
    console.error("[server] Cannot connect to database. Exiting.");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`[server] ✅ Running on http://localhost:${PORT}`);
    console.log(
      `[server] Ingest endpoint: POST http://localhost:${PORT}/ingest`,
    );
    console.log(
      `[server] Dashboard API:   GET  http://localhost:${PORT}/events/overview`,
    );
  });
}

start();
