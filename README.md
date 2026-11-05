# Urja Meter Ops API

A clean, documented HTTP API over the "Urja Meter Ops" portal, an ageing internal web app (no API of its own) used by utility staff to look up smart meters. This service lets another engineer or program consume meter details, network hierarchy, and consumption readings without ever touching the portal.

> Status: work in progress. Sections marked _TODO_ are filled in as the build proceeds.

---

## 1. Summary

The portal has no API, so teams copy-paste from the browser. This service reverse-engineers the portal's internal JSON endpoints (documented in [PROTOCOL.md](./PROTOCOL.md)), pulls the full dataset once via a background **sync**, normalizes it, and holds an immutable **snapshot** in memory. Every API request is served from that snapshot, so the API stays fast and keeps working even if the portal is down.

- API base path: `/api/v1`
- Interactive docs (Scalar): `/docs`
- OpenAPI spec: `/openapi.json`

## 2. Quick start

Prerequisites: Node 20+ (developed on Node 22).

```bash
git clone <repo-url>
cd urja-api
cp .env.example .env    # then fill in PORTAL_PASSWORD
npm install
npm run build
npm start
```

Then open http://127.0.0.1:3000/docs

For development with auto-reload: `npm run dev`.

### Environment

Copy `.env.example` to `.env` and set the portal password. See [Configuration](#6-configuration).

## 3. Sample requests

_TODO._


## 4. What I built

_TODO._

Sync-then-serve: a background job pulls everything from the portal (signed bulk export, transformers, per-meter energy), normalizes it in a pure domain layer, and swaps a new immutable snapshot into memory. Routes read only the snapshot; they never call the portal.

## 5. Project structure

```
src/
  portal/   only layer that knows the portal exists (client, signing, errors, types)
  domain/   pure normalization (no network, no disk)
  store/    in-memory snapshot + persistence to data/snapshot.json
  sync/     fetchAll, runSync, scheduler
  routes/   API endpoints, read snapshot only
  schemas/  TypeBox request/response schemas
  lib/      small shared helpers
scripts/    crawl, export-openapi
test/       unit tests + fixtures (never hit the live portal)
docs/        investigation log
```

## 6. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORTAL_URL` | https://urja-ops.flockenergy.tech | Portal base URL |
| `PORTAL_EMAIL` | operator@urja.local | Portal login email |
| `PORTAL_PASSWORD` | (none) | Portal login password (required) |
| `HOST` | 127.0.0.1 | Bind address (Docker sets 0.0.0.0) |
| `PORT` | 3000 | Listen port |
| `API_KEY` | (none) | If set, inbound requests must send `X-API-Key` |
| `SYNC_INTERVAL_HOURS` | 6 | How often the background sync runs |

## 7. Endpoints overview

See [openapi.json](./openapi.json) for the full contract.

 _TODO: short table._

## 8. How it talks to the portal

Short version: cookie session via a SvelteKit form login, one HMAC-signed bulk export request, plus per-meter energy calls. Full details, quirks, and surprises are in [PROTOCOL.md](./PROTOCOL.md).

## 9. Assumptions

_TODO._

## 10. Design decisions and trade-offs

_TODO._

## 11. Data quality handling

_TODO._

## 12. Optional extensions

_TODO._ 

## 13. What I intentionally skipped and why

_TODO._

## 14. Scaling limits and what I'd change

_TODO._

## 15. What I'd improve with more time

_TODO._

## 16. Testing

_TODO._

## 17. Running with Docker

_TODO._

## 18. AI assistance

AI Assistant (Claude Code) was used as a tool to work through the problem, draft the documentation, and assist in writing and reviewing code to my direction. The investigation of the portal was mine; see [docs/investigation-log.md](./docs/investigation-log.md).

## 19. Links

- [PROTOCOL.md](./PROTOCOL.md) how the portal actually works
- [openapi.json](./openapi.json) API contract
- [REFLECTION.md](./REFLECTION.md)
- [docs/investigation-log.md](./docs/investigation-log.md)
