# Urja Meter Ops API

The Urja Meter Ops portal is an ageing internal web portal used to look up smart meters: a meter's details, where it sits in the electricity network, and its recent consumption. The portal has no API, so copy-paste from the browser is the only option. This project is a clean, documented HTTP API placed on top of that portal, so another engineer or program can read meter data without ever touching the portal.

## 1.1 What I built and how it is structured

This service reverse-engineers the portal's internal JSON endpoints, pulls the full dataset once via a background **sync**, normalizes it, and holds an immutable **snapshot** in memory. It also saves that snapshot to disk (`data/snapshot.json`). Every API request is served from that snapshot, so the API stays fast and keeps working even if the portal is down.

- **Snapshot**: one complete, cleaned copy of all the data, held in memory and disc, that the API answers from.
- **Sync**: the background job that pulls everything from the portal and builds a new snapshot.

- API base path: `/api/v1`
- Interactive API docs (Scalar): `/docs`
- OpenAPI spec: `/openapi.json`

### Request flow:
1. A client calls, say, `GET /api/v1/meters`.
2. The route reads the in-memory snapshot and filters/pages it.
3. It returns JSON. No portal call happens during the request.

### Sync flow:
1. On startup the service loads the last saved snapshot from disk (so it can answer immediately), then starts a background sync. 
2. The sync logs in, fetches the signed bulk export (all meters), the transformer list, and each meter's energy readings. It takes a maximum of 3 minutes to fetch complete data, the reason for which is the rate limit of ~60sec on the portal. 
3. It cleans the data, builds a fresh snapshot, and swaps it in atomically (readers never see a half-built snapshot).
4. It repeats on a timer proactively to maintain freshness (every `SYNC_INTERVAL_HOURS`, default 6). 

## 1.2 Project structure

```
src/
  portal/   the only code that knows the portal exists (login, request signing, HTTP client, error types)
  domain/   pure data cleaning: readings, meters, transformers, hierarchy, data-quality issues (no network, no disk)
  store/    the in-memory snapshot and saving/loading it to data/snapshot.json
  sync/     fetchAll (pull everything), runSync (pull + clean + swap), scheduler (startup + timer, single run at a time)
  routes/   the API endpoints; they only read the snapshot
  schemas/  TypeBox request/response schemas (also feed the OpenAPI spec)
  lib/      small shared helpers: config, error envelope, api-key auth, OpenAPI setup, geo distance, logger
scripts/    crawl (save raw portal data to disk), export-openapi (write openapi.json)
test/       signing test + route tests (without touching the live portal)
docs/       investigation-log.md (how the portal was figured out with timeline)
```

## 1.3 Tech stack used

- **TypeScript on Node 22**, ES modules.
- **Fastify v5** as the web framework, with **TypeBox** for request/response schemas.
- **@fastify/swagger** produces the OpenAPI 3.1 spec; **Scalar** renders it at `/docs`.
- **p-limit** caps how many portal requests run at once (to be gentle on the portal).

## 2.1 Quick start

Prerequisites: Node 20+ (built on Node 22).

```bash
git clone https://github.com/MayankMohit/urja-portal-api.git
cd urja-portal-api
cp .env.example .env 
npm install
npm run build
npm start
```

Then open http://127.0.0.1:3000/docs

For development: `npm run dev`.

The first sync runs in the background on startup. A full cold fetch of all 403 meters takes up to about 3 minutes because of the portal's rate limit (explained below). The API answers immediately from the saved snapshot while that runs.

## 2.2 Running with Docker

Prerequisite is Docker Desktop (or Docker Engine) with Docker Compose.

```bash
git clone https://github.com/MayankMohit/urja-portal-api.git
cd urja-portal-api
cp .env.example .env     # set PORTAL_PASSWORD
docker compose up --build
curl http://localhost:3000/api/v1/health
```

Then open http://localhost:3000/docs. The first sync runs in the background (up to ~3 minutes on a cold start).

**Note**: if you ever want a fresh start, stop the container first (`docker compose down`), then delete `data/snapshot.json`, then start again.

## 2.3 Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORTAL_URL` | https://urja-ops.flockenergy.tech | Portal base URL |
| `PORTAL_EMAIL` | operator@urja.local | Portal login email |
| `PORTAL_PASSWORD` | (none, required) | Portal login password |
| `HOST` | 127.0.0.1 | Address to bind (Docker uses 0.0.0.0) |
| `PORT` | 3000 | Port to listen on |
| `API_KEY` | dev-local-key | If set, `POST /sync` requires this value in an `X-API-Key` header. If empty, `POST /sync` is disabled. The read API is always open. `.env.example` ships with a sample value; change it for any real deployment. |
| `SYNC_INTERVAL_HOURS` | 6 | How often the background sync runs |

Then open http://127.0.0.1:3000/docs

For development with auto-reload: `npm run dev`.

## 3.1 Sample requests

Use `curl` in Git Bash or `curl.exe` in PowerShell. 

```bash
# Service health
curl "http://localhost:3000/api/v1/health"

# First two meters (paged)
curl "http://localhost:3000/api/v1/meters?pageSize=2"

# Filter: installed HPL meters
curl "http://localhost:3000/api/v1/meters?status=installed&make=HPL"

# Meters near a point, within 5 km, with distance
curl "http://localhost:3000/api/v1/meters?near=26.9,75.8&radiusKm=5"

# One meter, full detail
curl "http://localhost:3000/api/v1/meters/J100000"

# One meter's readings in a window (use full ISO with +05:30, not date-only)
curl "http://localhost:3000/api/v1/meters/J100000/readings?from=2026-06-23T00:00:00%2B05:30&to=2026-07-01T00:00:00%2B05:30"

# All transformers, and one with an alias and 13 meters
curl "http://localhost:3000/api/v1/transformers"
curl "http://localhost:3000/api/v1/transformers/DT-007"

# Network tree, trimmed to 2 levels
curl "http://localhost:3000/api/v1/network?depth=2"

# Data-quality issues (and a filter)
curl "http://localhost:3000/api/v1/data-quality?severity=warning"

# Last sync summary
curl "http://localhost:3000/api/v1/sync/status"

# Trigger a sync (needs API_KEY set); add ?full=true to refetch everything
curl -X POST http://localhost:3000/api/v1/sync -H "X-API-Key: <your-key>"
```

Example trimmed response (`GET /api/v1/meters?pageSize=1`):

```json
{
  "data": [
    {
      "meterId": "J100000",
      "serialNo": "SE33962",
      "make": "HPL",
      "phase": "single",
      "status": "decommissioned",
      "installType": "whole_current",
      "build": "legacy",
      "dtCode": "DT-001",
      "geo": { "lat": 26.938961, "lng": 75.830957 }
    }
  ],
  "meta": { "page": 1, "pageSize": 1, "total": 403, "syncedAt": "...", "dataAsOf": "2026-06-30T23:30:00+05:30" }
}
```

## 3.2 Endpoints overview

Full contract is in `openapi.json` and the live interactive docs (Scalar) at `/docs`. Short list:

| Method & path | What it does |
|---|---|
| `GET /api/v1/health` | Service status, portal reachability (inferred from the last sync), snapshot info |
| `GET /api/v1/meters` | List meters with filters (status, make, phase, install type, build, any hierarchy level code, transformer), text search `q`, `near=lat,lng` + `radiusKm`, and paging |
| `GET /api/v1/meters/{meterId}` | One meter: attributes, location, full network path, aliases, a readings summary, and its data-quality issues |
| `GET /api/v1/meters/{meterId}/readings` | Time series with per-interval consumption and a summary (totals, voltage min/max/avg, out-of-band count). Optional `from`, `to`, `nominalVoltage` (230), `tolerancePct` (6) |
| `GET /api/v1/transformers` | All 40 transformers with meter counts and network path |
| `GET /api/v1/transformers/{code}` | One transformer plus the meters under it |
| `GET /api/v1/network` | The repaired network tree; optional `?depth=N` |
| `GET /api/v1/data-quality` | All data-quality issues, filterable, with counts by type |
| `GET /api/v1/sync/status` | Summary of the last sync |
| `POST /api/v1/sync` | Trigger a sync. Protected by `X-API-Key`. Incremental by default; `?full=true` refetches everything |
| `GET /docs` | Interactive docs (Scalar) |
| `GET /openapi.json` | The OpenAPI spec |

Response shapes:
- List responses: `{ "data": [...], "meta": { page, pageSize, total, syncedAt, dataAsOf } }`
- Single-item responses: `{ "data": {...}, "meta": { syncedAt, dataAsOf } }`
- Errors: `{ "error": { "code": "...", "message": "...", "details": {...} } }`
- Before the first sync finishes there is no snapshot, so read routes return `503 snapshot_unavailable`. Unknown IDs return `404`. Bad query parameters return `400`.
- `syncedAt` = when we last fetched. `dataAsOf` = the latest reading timestamp in the data (currently `2026-06-30T23:30:00+05:30`).

## 3.3 Trying the protected route (POST /sync)

Everything above (every GET route) is open and needs no key, so you can evaluate the whole read API with zero setup. `POST /sync` is the only protected route, because it is the one action that triggers a live crawl of the portal. To try it:

- **You set the key, not me.** When you run the service, you choose `API_KEY` in your own `.env`. Then send that same value as the `X-API-Key` header. You are not relying on any key of mine; it is whatever you put in `.env`.
- **Easiest path:** copy `.env.example` to `.env`. It ships with a sample `API_KEY=dev-local-key`, so `POST /sync` works out of the box: send header `X-API-Key: dev-local-key`. Change it to anything you like. (This is a local on/off gate, not a real secret.)
- **If you leave `API_KEY` empty, the route is disabled on purpose** and returns `403 sync_disabled` (fail-closed, so there is no unauthenticated "crawl the portal" button). The read API still works, and `GET /sync/status` still shows the last sync.

Example:

```bash
curl -X POST http://localhost:3000/api/v1/sync -H "X-API-Key: dev-local-key"
# add ?full=true to refetch every meter instead of only the missing ones
```

## 5.1 How it talks to the portal

The portal is a SvelteKit site with Better Auth cookie sessions. The service logs in with a form POST (needs an `Origin` header), gets a session cookie, then: makes one HMAC-signed bulk export call (all meters, their hierarchy, and geo), reads the transformer list, and fetches each meter's energy readings. Full details, quirks, and surprises are in `PROTOCOL.md`.

## 5.2 Testing (how to run, what is covered)

```bash
npm test         # run all tests
```

- `test/signing.test.ts`: proves our HMAC signing matches the portal's, using a known-good value computed in the browser with a fake secret.
- `test/routes.test.ts`: black-box tests of every API route using Fastify's inject (no network). Covers health, meters list/detail/readings, transformers, network, data-quality, sync status, the docs endpoints, and the `POST /sync` auth responses. It builds the app with a fake config (the sync scheduler is never started, so no portal calls) and a small hand-made snapshot.
- All tests passed.

## 5.3 AI assistance

The investigation of the portal was done by me, by hand, in the browser and with curl (see `docs/investigation-log.md`). I used an AI coding assistant as a tool, under my direction, to help write and review code and to draft the documentation. Design decisions and the portal reverse-engineering are my own.

## 5.4 Links

- `PROTOCOL.md`: how the portal actually works.
- `openapi.json`: the API contract. Rendered at `/docs`.
- `NOTES.md`: assumptions, design decisions and trade-offs, what was skipped, and what I would improve.
- `REFLECTION.md`: the reflection answers.
- `docs/investigation-log.md`: the step-by-step log of figuring the portal out.

---