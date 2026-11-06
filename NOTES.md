# Notes

## Assumptions I made

- **Timestamps are IST (+05:30).** The readings have no timezone. It is an Indian utility, the meters are in Jaipur. If this is wrong, every timestamp is off by the offset.
- **The data is a frozen snapshot.** Readings stop on 30 June 2026 and the same meter returns the same data at different times. So the data does not change, which makes caching safe and lets the sync be incremental (fetch a meter once, and never fetch it again unless forced).
- **Export is the source of truth for meter attributes**, and the transformer list (`/portal/dts`) is the source of truth for transformer names. Where the two disagree (DT-007), the dts name wins and the other becomes an alias.
- **Voltage "normal" band is 230 V ±6% (216.2 to 243.8 V)** for the out-of-band count. This is a common LT limit, and it is configurable per request.
- **kWh and kVAh are cumulative meter registers** (running totals), so per-interval consumption is the difference between consecutive readings.
- **Power factor is approximate**, taken as kWh/kVAh per interval.
- **The signing timestamp window is about ±300 seconds** (measured by trying a few offsets, not documented).
- **The rate limit resets on about a 60-second window and allows roughly 120 requests per burst** (measured, not documented).
- **Geo coordinates are synthetic** (a meter can be ~21 km from the center of its own transformer's meters), so geo is used only as a plain attribute, not as network truth.

## Design decisions and trade-offs

- **Sync then serve (chosen).** Pull everything once, serve from memory.
  - Why: a full pull is ~400 portal calls and ~11 MB and takes minutes; doing that per request would be slow and would hammer the portal. Serving from memory is fast, enables cross-field filters and "near me" and hierarchy and anomaly checks, and keeps working if the portal is down.
  - Alternatives rejected: live pass-through (simple but slow, ties our uptime to the portal, and risks repeated logins)
- **Immutable snapshot, swapped atomically.** A new snapshot is built fully, then swapped in. Readers never see a half-built state. Saved to disk with write-to-temp-then-rename so a crash cannot leave a corrupt file.
- **Incremental sync (frozen data).** The sync only fetches a meter's readings if it does not already have them. This keeps each sync small and, crucially, keeps it under the portal's burst rate limit. A full refetch is still available with `POST /sync?full=true`.
  - The cost: because a meter we already have is skipped entirely (not even refetched to compare), a new reading appearing on it would be invisible to an incremental sync. Only a `full` sync picks it up. The scheduled background sync is incremental, so under the frozen-data assumption this is free, but if the portal ever unfreezes, full refreshes are a manual step.
- **Retry budget tuned to the portal.** The portal rate limit resets on about a 60-second window and lets ~120 meters through per pass. So the sync retries only the rate-limited meters, up to 5 passes, with a 60-second cooldown between passes. A full cold fetch of all 403 then takes 4 passes (first instant, then 3 after cooldowns), about 3 minutes maximum.
- **Partial failure is handled, not fatal.** If the export or transformer list fails, the sync aborts and keeps the previous snapshot (status `failed`). If some meters' readings fail, their previous readings are kept and marked `stale` (or `unavailable` if we never had them), and the sync is `partial`, not failed.
- **Freshness by content, not just time.** Each portal response is hashed (SHA-256); the sync reports how many actually changed. `syncedAt` and `dataAsOf` are returned in every response.
- **Hierarchy nodes are identified by full path, not by code.** The same code (like `D-01`) is reused under different parents, so a bare code is not unique. The node ID is the full chain of codes from zone down to DT.
- **Blank hierarchy values are repaired from siblings.** A blank code or name is filled from other meters on the same transformer and flagged as repaired; if no sibling has it, it is left empty and flagged missing.
- **One security key, on one route.** Only `POST /sync` (the single action that reaches the portal) is protected with an `X-API-Key`. The read API, docs, and health stay open. If no key is configured the route fails closed (returns 403) rather than exposing an unauthenticated portal crawl trigger.
- **No extra rate-limit library.** The `POST /sync` cooldown is a tiny built-in check; a dependency was not needed.

## What I intentionally left out, and why

- **The SvelteKit `__data.json` page data.** It uses a special encoding (devalue) and has two different shapes (legacy vs v2). The bulk export already gives the same attributes more cleanly, so this was skipped. (Both formats are still documented in [PROTOCOL.md](./PROTOCOL.md).)
- **`/portal/meters/search`.** The bulk export already returns all meters, so the search endpoint is not needed.
- **`/portal/meters/{id}/geo`.** The export already includes geo, so the separate geo call is not needed.

## What I would improve or do differently with more time

- Add real unit tests for the normalization rules (timestamps, register differences, dedup, power factor) and for hierarchy repair.
- Add portal-client tests that simulate the two 401s, the 429 rate limit, and signature failures.
- Build the frontend: per-meter consumption and voltage charts, a status-colored map, a hierarchy explorer, a data-quality view and a lot more.
- Make the sync self-converge: after a `partial` sync, automatically retry the missing meters until complete, instead of waiting for the next scheduled run.
- For real scale (100k+ meters or years of 30-minute data), move from in-memory to a database (Postgres + TimescaleDB), fetch only new readings, use a real geo index (PostGIS), and schedule syncs per meter.
- Add metrics and structured logging/observability.
- Measure the rate-limit window and threshold more precisely instead of using safe round numbers.

## Scaling limits and what I would change

- In memory, this comfortably handles a few thousand meters and a week of readings.
- It stops being a good fit at roughly 100k meters, or years of 30-minute readings, because everything lives in RAM and a full rebuild would be heavy.
- At that point: use a time-series database, sync incrementally (only new rows), index geo properly, and run syncs per meter or per transformer rather than one big job.

---