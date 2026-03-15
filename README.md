# @more-retail/rum-backend

Node.js + Express ingest API and query backend for the RUM Dashboard.

---

## Prerequisites

- Node.js 18+
- PostgreSQL 14+

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create the database
```bash
psql -U postgres -c "CREATE DATABASE rum_dashboard;"
```

### 3. Configure environment
```bash
cp .env.example .env
```
Edit `.env` and set your `DB_PASSWORD` (and other values if needed).

### 4. Run migrations (creates all tables)
```bash
npm run db:migrate
```

### 5. (Optional) Seed with test data
```bash
npm run db:seed
```

### 6. Start the server
```bash
npm run dev     # development (auto-restarts on file change)
npm start       # production
```

Server runs on **http://localhost:4000**

---

## API Reference

### Ingest (SDK → Backend)

```
POST /ingest
Content-Type: application/json

{
  "events": [
    {
      "type": "api_call",
      "appId": "picker-app",
      "sessionId": "ses_abc123",
      "userId": "usr_001",
      "timestamp": "2024-01-15T10:30:00.000Z",
      "data": { "url": "/api/orders", "method": "GET", "status": 200, "duration": 145 }
    }
  ]
}
```

Response:
```json
{ "received": 1, "processed": 1, "skipped": 0 }
```

---

### Dashboard Queries

All query endpoints accept these common filters:
| Param | Description | Default |
|---|---|---|
| `appId` | Filter by app | all |
| `from` | Start timestamp (ISO) | 24h ago |
| `to` | End timestamp (ISO) | now |
| `sessionId` | Filter by session | all |
| `userId` | Filter by user | all |
| `limit` | Max results (≤500) | 100 |
| `offset` | Pagination offset | 0 |

#### Overview
```
GET /events/overview?appId=picker-app
```

#### Sessions
```
GET /events/sessions?appId=picker-app&from=2024-01-01T00:00:00Z
```

#### JS Errors
```
GET /events/errors?appId=picker-app
```

#### API Calls
```
GET /events/api-calls?appId=picker-app&slow=true
GET /events/api-calls?url=/api/orders&method=GET
```

#### Web Vitals
```
GET /events/performance?appId=picker-app
```

#### Page Views
```
GET /events/page-views?appId=picker-app
```

#### Health Check
```
GET /health
```

---

## Database Schema

```
events               ← all raw events (every SDK emit lands here)
sessions             ← pre-aggregated session summaries
api_calls            ← structured network call data
js_errors            ← structured JS error data
performance_metrics  ← FCP, LCP, FID, CLS, page_load
page_views           ← page visit data
```
