/**
 * db/seed.js
 * Seeds the database with realistic test data for the picker app.
 * Run with: npm run db:seed
 */

import { query, testConnection } from "./pool.js";
import dotenv from "dotenv";

dotenv.config();

const APPS = ["picker-app", "manager-dashboard"];
const USERS = [
  { id: "usr_001", name: "Adarsh C",    role: "manager" },
  { id: "usr_002", name: "Ravi Kumar",  role: "picker" },
  { id: "usr_003", name: "Priya S",     role: "picker" },
  { id: "usr_004", name: "Ankit M",     role: "picker" },
];
const PAGES = ["/dashboard", "/orders", "/orders/:id", "/scan", "/profile"];
const ENDPOINTS = [
  "/api/orders",
  "/api/orders/:id",
  "/api/orders/:id/assign",
  "/api/products/:id",
  "/api/scan/barcode",
  "/api/auth/me",
];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function tsAgo(msAgo) {
  return new Date(Date.now() - msAgo).toISOString();
}

async function seed() {
  await testConnection();
  console.log("[seed] Inserting test data...");

  // Clear existing seed data
  await query("DELETE FROM events WHERE app_id = ANY($1)", [APPS]);
  await query("DELETE FROM sessions WHERE app_id = ANY($1)", [APPS]);

  let eventCount = 0;

  for (let s = 0; s < 30; s++) {
    const user    = pick(USERS);
    const appId   = pick(APPS);
    const sessionId = `ses_seed_${s.toString().padStart(3, "0")}`;
    const deviceId  = `dev_seed_${user.id}`;
    const sessionStart = rand(1, 48) * 60 * 60 * 1000; // within last 48h

    // Insert session
    await query(
      `INSERT INTO sessions
        (id, app_id, device_id, user_id, user_meta, started_at, last_seen_at,
         page_views, error_count, click_count, api_call_count, entry_page)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        sessionId, appId, deviceId, user.id,
        JSON.stringify({ name: user.name, role: user.role }),
        tsAgo(sessionStart), tsAgo(sessionStart - rand(60000, 600000)),
        rand(2, 15), rand(0, 3), rand(5, 40), rand(3, 20),
        pick(PAGES),
      ]
    );

    // Insert 5-15 events per session
    const numEvents = rand(5, 15);
    for (let e = 0; e < numEvents; e++) {
      const eventType = pick([
        "page_view", "page_view", "page_view",
        "interaction", "interaction",
        "api_call", "api_call", "api_call",
        "js_error",
        "performance",
      ]);

      const ts = tsAgo(sessionStart - e * rand(5000, 30000));
      const page = pick(PAGES);

      let data = {};
      if (eventType === "page_view") {
        data = { page, title: page.replace("/", "").replace("-", " ") || "Home", referrer: null };
      } else if (eventType === "interaction") {
        data = { action: "click", tag: "button", label: pick(["Confirm Order", "Scan Item", "Assign Picker", "View Details"]), page };
      } else if (eventType === "api_call") {
        const status  = pick([200, 200, 200, 200, 201, 400, 404, 500]);
        const duration = rand(50, 2000);
        data = {
          url: pick(ENDPOINTS), method: pick(["GET", "GET", "POST", "PATCH"]),
          status, ok: status < 400, duration, slow: duration > 1000, page,
        };
      } else if (eventType === "js_error") {
        const errors = [
          { message: "Cannot read properties of undefined (reading 'orderId')", name: "TypeError" },
          { message: "Network request failed", name: "Error" },
          { message: "Barcode scan timeout", name: "ScanError" },
        ];
        data = { ...pick(errors), source: "window.onerror", page };
      } else if (eventType === "performance") {
        const metric = pick(["FCP", "LCP", "FID", "CLS", "page_load"]);
        const vals   = { FCP: rand(800, 3500), LCP: rand(1200, 5000), FID: rand(10, 400), CLS: parseFloat((Math.random() * 0.3).toFixed(3)), page_load: rand(500, 4000) };
        data = { metric, value: vals[metric], rating: vals[metric] < 2000 ? "good" : "poor", page };
      }

      const result = await query(
        `INSERT INTO events (type, app_id, session_id, device_id, user_id, timestamp, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [eventType, appId, sessionId, deviceId, user.id, ts, JSON.stringify(data)]
      );

      const eventId = result.rows[0].id;

      // Mirror into sub-tables
      if (eventType === "api_call") {
        await query(
          `INSERT INTO api_calls (event_id, session_id, app_id, user_id, url, method, status, ok, duration_ms, slow, page, timestamp)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [eventId, sessionId, appId, user.id, data.url, data.method, data.status, data.ok, data.duration, data.slow, data.page, ts]
        );
      } else if (eventType === "js_error") {
        await query(
          `INSERT INTO js_errors (event_id, session_id, app_id, user_id, message, name, source, page, timestamp)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [eventId, sessionId, appId, user.id, data.message, data.name, data.source, data.page, ts]
        );
      } else if (eventType === "performance") {
        await query(
          `INSERT INTO performance_metrics (event_id, session_id, app_id, metric, value, rating, page, timestamp)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [eventId, sessionId, appId, data.metric, data.value, data.rating, data.page, ts]
        );
      } else if (eventType === "page_view") {
        await query(
          `INSERT INTO page_views (event_id, session_id, app_id, user_id, page, title, timestamp)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [eventId, sessionId, appId, user.id, data.page, data.title, ts]
        );
      }

      eventCount++;
    }
    process.stdout.write(".");
  }

  console.log(`\n[seed] ✅ Inserted ${eventCount} events across 30 sessions.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed] Failed:", err.message);
  process.exit(1);
});
