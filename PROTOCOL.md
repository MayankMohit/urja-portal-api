# PROTOCOL.md (how the portal actually works)

## 1.1 Summary (what the portal is)

The portal is a SvelteKit web app with Better Auth cookie sessions, served over HTTPS from a single host. Every `/portal/*` endpoint returns JSON, even on errors. It has no public API; its data lives behind the logged-in pages and a few internal JSON endpoints, one of which (the bulk export) additionally requires a signed request.

## 1.2 How I investigated

Chrome DevTools (Network tab with "Preserve log", Sources search for `/portal/`, and the Console for testing the signing), plus curl in Git Bash, plus small throwaway counting scripts. See [docs/investigation-log.md](./docs/investigation-log.md) for the timeline.

## 1.3 What data is available and how to get it

- **Meter master data** (all 403 meters: identity, make, phase, install status and type, build): one signed call to `GET /portal/export`. The only call that needs a signature, and the source of truth for meter attributes.
- **Network hierarchy** (zone > circle > division > subdivision > substation > feeder > DT, each with a name and code): embedded in every meter record in the export under `hierarchy`. There is no separate hierarchy endpoint; you rebuild the tree from the meters.
- **Geo location** (latitude/longitude per meter): embedded in each export record under `geo`.
- **Transformers / DTs** (40 of them: name, feeder code, capacity in kVA): `GET /portal/dts?page=N`, 20 per page, paged until `total`.
- **Consumption readings** (per meter time series of `timestamp`, `kwh`, `kvah`, `voltR`): `GET /portal/meters/{id}/energy`, one call per meter, a fixed historical window.

A full pull is: one signed export (every meter plus hierarchy and geo), the DT pages, then one energy call per meter.

## 1.4 Authentication and sessions

- Login is a SvelteKit form action: `POST /login`, `Content-Type: application/x-www-form-urlencoded`, fields `email` and `password`.
- Two required headers: `Accept: application/json` and `Origin: https://urja-ops.flockenergy.tech` (the Origin header is SvelteKit's CSRF protection; there is no CSRF token in the body).
- Success: HTTP 200 with the exact body `{"type":"redirect","status":303,"location":"/meters"}` plus a `Set-Cookie` for `__Secure-better-auth.session_token` (`Max-Age=3600`, `HttpOnly`, `Secure`, `SameSite=Lax`).
- The HTTP status alone does not tell you if login worked; the body does:
  - Wrong password returns HTTP 200 with `{"type":"failure","status":401,...}`.
  - Missing `Origin` returns HTTP 403 `{"message":"Cross-site POST form submissions are forbidden"}`.
- So treat login as successful only when status is 200, body `type` is `redirect`, and the cookie is present.
- The cookie is read from `Set-Cookie` and sent back manually as a `cookie` header (just `name=value`). No cookie jar.
- Session lifetime is a hard ~1 hour, enforced by both the cookie `Max-Age` and the server (an old token is rejected even with activity). The client re-logs in proactively around 55 minutes and reactively when it sees `unauthorized`.

## 1.5 The two 401s (opposite reactions)

A 401 from `/portal/*` carries one of two `error` values:
- `unauthorized`: the session is missing/expired/invalid. Reaction: log in again, retry once.
- `signature_invalid`: the request signature is wrong or stale. Reaction: do NOT log in; refetch the signing secret, re-sign with a fresh timestamp, retry once.
- The session is checked before the signature (an unsigned, unauthenticated export returns `unauthorized`, not `signature_invalid`).

## 1.6 Request signing and the bulk export

- Fetch the secret: `GET /portal/keys` returns `{ "data": { "signingSecret": "..." } }`.
  - The secret is global (same across calls and sessions) and readable by any logged-in user, so it is an anti-scripting hurdle, not real security. The client caches it for the process and refetches only on `signature_invalid`.
- Build the string to sign as four parts joined by newlines, in order: method, path, query, timestamp. Example: `GET\n/portal/export\npage=1\n1762318800`. The query has no leading `?`; the timestamp is Unix seconds as a string.
- Sign with `HMAC-SHA256(secret, string)` and send as lowercase hex.
- Send `x-timestamp: <seconds>` and `x-signature: <hex>` headers.
- The timestamp window is (inferred) about ±300 seconds; outside it the request is rejected as `signature_invalid`.
- The `page` query must be part of the signed string but is ignored by the server: the export always returns all meters.
- If a signed request is rejected and the server's `Date` header differs from the local clock by more than 60 seconds, the client applies that offset to future timestamps (to survive clock skew).

## 1.7 Endpoints the service calls

- `POST /login` (Origin + form body): session cookie.
- `GET /portal/keys` (session): the global signing secret.
- `GET /portal/export?page=1` (session + signature): `{ data: [ ...all 403 meters ], total: 403 }` (~231 KB).
- `GET /portal/dts?page=N` (session): `{ data: [ ...transformers ], total }`, 20 per page, 40 DTs over 2 pages.
- `GET /portal/meters/{id}/energy` (session): `{ data: [ ...readings ] }`, no query parameters, a fixed window (~27.5 KB).

Not used (and why): `/portal/meters/search` (export covers it), `/portal/meters/{id}/geo` (export has geo), and the SvelteKit `__data.json` page data (needs devalue decoding and has two formats; export covers the same attributes).

## 1.8 Response shapes

Values are taken exactly as sent; nothing is renamed and numbers that arrive as strings stay strings.
- Export meter (10 fields): `meterId`, `serialNo`, `make`, `phaseType`, `installStatus`, `installType`, `build`, `dtCode`, `hierarchy` (nested `zone/circle/division/subdivision/substation/feeder/dt`, each `{ name, code }`), and `geo` (`{ lat, lng }` as numbers).
- Transformer (DT): `{ code, name, feederCode, capacityKva }`.
- Energy reading: `{ timestamp, kwh, kvah, voltR }`, all four are strings; timestamp is `DD/MM/YYYY HH:mm` with no timezone.

## 1.9 Rate limiting

- The portal rate-limits in bursts: a run of requests succeeds, then a block returns HTTP 429 `{"error":"rate_limited",...}`, then it recovers after a cooldown.
- There is NO `Retry-After` header and no `x-ratelimit-*` headers on the 429, so there is no server hint to honour.
- Measured behavior: the limit resets on about a 60-second window, and roughly 120 requests get through per burst before it trips.
- So fast-retrying a 429 just makes more 429s. The service instead: does not fast-retry a 429, keeps concurrency at 4 or fewer, and retries only the rate-limited meters in later passes with a 60-second cooldown between passes.
- Result: a full cold fetch of all 403 meters takes 4 passes (first pass instant, then 3 more after a 60-second cooldown each), a maximum of about 3 minutes.

## 1.10 Data model and quirks found

Meter dataset (`/portal/export`):
- 403 meters, IDs J100000 to J100402, contiguous, no duplicate IDs or serials.
- Value counts: make HPL 90, Genus 88, Secure 85, Allied 76, L&T 64. Phase single 277, three 126. Install status Installed 238, Faulty 90, Decommissioned 75. Install type Whole Current 205, CT Operated 198. Build legacy 238, v2 165.
- Serial prefixes: AL 90, SE 80, GE 78, L& 77, HP 75, GN 3. The prefix does not match the make.
- 10 meters per DT, except DT-007 which has 13.
- `dtCode` always equals `hierarchy.dt.code`.

Network hierarchy:
- Levels: Zone > Circle > Division > Subdivision > Substation (UI label "Sub Station") > Feeder > DT > Meter.
- Code formats: `Z-01`, `C-01`, `D-01`, `SD-01`, `SS-01` (2 digits), and `F-001`, `DT-001` (3 digits).
- Distinct codes per level: 3 zones, 6 circles, 10 divisions, 14 subdivisions, 18 substations, 28 feeders, 40 DTs.
- But codes are reused across branches (for example `D-01` appears under three different circles). So a bare code does not identify a node; the full path does. Counting nodes by full path gives 3 / 6 / 30 / 40 / 40 / 40 / 40.
- Some hierarchy values are blank at the source (22 in total: certain circle codes/names, substation codes, feeder codes/names). Zone, division, subdivision, and DT are never blank.
- The DT is a reliable anchor: ignoring blanks, every DT has exactly one consistent path up to its zone.

Transformers (`/portal/dts`):
- 40 DTs, DT-001 to DT-040. Capacities are standard Indian ratings: 63, 100, 160, 250, 400 kVA.
- Twelve feeders serve two DTs each (DT-029..DT-040 reuse feeder codes F-001..F-012), more evidence that a code needs its full path.
- DT-007 has two names: "Sanganer DT 7" (the dts list) versus "Old Malviya Nagar Xfmr". Treated as a stale name: the dts list wins, the old one is kept as an alias.

Readings (`/portal/meters/{id}/energy`):
- Fields `timestamp`, `kwh`, `kvah`, `voltR`, all strings, with inconsistent number formatting.
- `kwh` and `kvah` are cumulative registers (they only go up); per-interval consumption is the difference between consecutive readings.
- kVAh rises a bit faster than kWh; the ratio approximates power factor (~0.93 for J100000).
- Only R-phase voltage is given, even for three-phase meters.
- Reading frequency: exactly 40 meters (J100000 to J100039, one per DT) report every 30 minutes (337 rows); the other 358 report once a day (8 rows at 00:00). Daily is the norm.
- One real defect: 5 meters (J100089, J100134, J100195, J100211, J100330) have a duplicated final row where some values are blank. This is both the only duplicate-timestamp case and the only unparseable-value case. Keeping the first row on a duplicate timestamp cleans it up.
- Data stops on 30 June 2026 (about four months before "now"), and the same meter returns identical bytes at different times, so it looks like a frozen snapshot.

Two meter detail formats (documented even though the detail page is not used): "legacy" meters return a list of name/value pairs; "v2" meters return a JSON string under `classData`. The `build` field says which.

The J100400-J100402 cohort looks added later from another system: the last three IDs, only `GN` serials, all Genus, three-phase, CT Operated, Installed, legacy, all on DT-007 with the stale name.

## 1.11 Open questions / not fully tested

- Exact signing window (used ±300 seconds as a safe estimate).
- Exact rate-limit threshold and window (used ~120 per ~60 seconds).
- The meter search matching rules (not needed, so not tested).

---