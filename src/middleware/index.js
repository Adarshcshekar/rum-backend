/**
 * middleware/index.js
 * Shared Express middleware for the RUM backend.
 */

import rateLimit from "express-rate-limit";

/**
 * Rate limiter for the ingest endpoint.
 * High limit since SDKs send batches frequently.
 */
export const ingestLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"),
  max: parseInt(process.env.RATE_LIMIT_MAX || "500"),
  message: { error: "Too many requests — slow down" },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for dashboard query endpoints.
 */
export const queryLimiter = rateLimit({
  windowMs: 60000,
  max: 5000,
  message: { error: "Too many requests" },
});

/**
 * Request logger — logs method, path, status, and duration.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const level =
      res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO";
    console.log(
      `[${level}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`,
    );
  });
  next();
}

/**
 * Global error handler — catches anything thrown in route handlers.
 */
export function errorHandler(err, req, res, next) {
  console.error("[server] Unhandled error:", err.message);
  res.status(500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
}

/**
 * 404 handler — catches unmatched routes.
 */
export function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}
