/**
 * db/pool.js
 * PostgreSQL connection pool — shared across the entire app.
 * Uses pg.Pool for connection reuse and automatic reconnection.
 */

import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME     || "rum_dashboard",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "",
  // Keep up to 10 clients in the pool
  max: 10,
  // Close idle clients after 30s
  idleTimeoutMillis: 30000,
  // Fail fast if can't connect within 2s
  connectionTimeoutMillis: 2000,
});

// Log connection errors (don't crash the server)
pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

/**
 * Run a query with optional parameters.
 * @param {string} text - SQL query
 * @param {Array}  params - Query parameters
 */
export async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === "development" && duration > 200) {
      console.warn(`[DB] Slow query (${duration}ms):`, text.slice(0, 80));
    }
    return result;
  } catch (err) {
    console.error("[DB] Query error:", err.message, "\nQuery:", text);
    throw err;
  }
}

/**
 * Run multiple queries in a single transaction.
 * Automatically rolls back on any error.
 * @param {Function} fn - async function that receives a client
 */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Test the database connection.
 */
export async function testConnection() {
  try {
    const result = await query("SELECT NOW() as now");
    console.log("[DB] Connected →", result.rows[0].now);
    return true;
  } catch (err) {
    console.error("[DB] Connection failed:", err.message);
    return false;
  }
}

export default pool;
