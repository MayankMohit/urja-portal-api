# PROTOCOL.md: how the Urja Meter Ops portal actually works

## What data is available, and how to get it

The portal exposes five kinds of data. All of it sits behind a logged-in session; the bulk export additionally needs a request signature. Everything comes back as JSON.

- **Meter master data** (all 403 meters: identity, make, phase, install status/type, build): one signed call to `GET /portal/export`. This is the source of truth for meter attributes and the only call that needs signing.
- **Network hierarchy** (zone > circle > division > subdivision > substation > feeder > DT, with a name and code at each level): embedded inside every meter record in the export, under `hierarchy`. There is no separate hierarchy endpoint; you reconstruct the tree from the meters.
- **Geo location** (latitude and longitude per meter): also embedded in each export record, under `geo`.
- **Transformers / DTs** (40 distribution transformers: name, feeder code, capacity in kVA): `GET /portal/dts?page=N`, 20 per page, paged until `total`.
- **Consumption readings** (per meter, time series of `timestamp`, `kwh`, `kvah`, `voltR`): `GET /portal/meters/{id}/energy`, one call per meter, a fixed historical window.

So a full pull is: one signed export (every meter plus its hierarchy and geo), the DT pages, and then one energy call per meter. Details of each are below.

## Stack and transport

- The portal is a SvelteKit app (hashed `/_app/immutable/...` bundles, `__data.json` page-data requests).
- Sessions use Better Auth, carried in a cookie named `__Secure-better-auth.session_token`.
- Single host over HTTPS. Every `/portal/*` endpoint returns `application/json`, including on errors.

## Authentication and sessions

- Login is a SvelteKit form action: `POST /login` with `Content-Type: application/x-www-form-urlencoded` and fields `email` and `password`.
- Two headers are required:
  - `Accept: application/json`
  - `Origin: https://urja-ops.flockenergy.tech` (SvelteKit's CSRF check; there is no CSRF token in the body).
- Success is HTTP 200 with the exact body `{"type":"redirect","status":303,"location":"/meters"}` plus a `Set-Cookie` for the session token (`Max-Age=3600`, `HttpOnly`, `Secure`, `SameSite=Lax`).
- The HTTP status alone does not tell you if login worked; the body does:
  - Wrong password returns HTTP 200 with `{"type":"failure","status":401,...}`.
  - Missing `Origin` returns HTTP 403 `{"message":"Cross-site POST form submissions are forbidden"}`.
- So the client treats login as successful only when status is 200, body `type` is `redirect`, and the session cookie is present.
- The cookie is read from the `Set-Cookie` header and sent back manually as a `cookie` header (just the `name=value` part). There is no cookie jar.
- Session lifetime is a hard ~1 hour, enforced both by the cookie `Max-Age` and by the server (an older token is rejected even with activity). The client re-logs in proactively at ~55 minutes, and reactively on an `unauthorized` response.

## The two 401s (they need opposite reactions)

A 401 from `/portal/*` carries one of two `error` values, and the correct response differs:

- `unauthorized`: the session is missing, expired, or invalid. Reaction: log in again and retry once.
- `signature_invalid`: the request signature is wrong or stale. Reaction: do NOT log in; re-fetch the signing secret, re-sign with a fresh timestamp, and retry once.
- The session is checked before the signature: an unsigned, un-authed export returns `unauthorized`, not `signature_invalid`.

## Request signing and the bulk export

The one signed endpoint the service uses is the bulk export. Signing works like this:

- Fetch the secret: `GET /portal/keys` returns `{ "data": { "signingSecret": "..." } }`.
  - The secret is global (identical across calls and across sessions) and readable by any logged-in user, so it is an anti-scripting hurdle, not real security. The client caches it for the process lifetime and refetches only on `signature_invalid`.
- Build the string to sign as four parts joined by newlines, in order: `method`, `path`, `query`, `timestamp`.
  - Example: `GET\n/portal/export\npage=1\n1762318800`.
  - `query` has no leading `?`. `timestamp` is Unix seconds as a string.
- Sign with `HMAC-SHA256(secret, string)` and send as lowercase hex.
- Send two headers with the request: `x-timestamp: <seconds>` and `x-signature: <hex>`.
- Timestamp window is (inferred) symmetric +/- 300 seconds; outside it the request is rejected `signature_invalid`.
- The `page` query is accepted and must be part of the signed string, but is ignored by the server: the export always returns all meters.
- If a signed request is rejected and the server's `Date` header differs from the local clock by more than 60 seconds, the client applies that offset to future timestamps (defends against clock skew inside the window).

## Endpoints the service calls

- `POST /login` (Origin + form body): session cookie.
- `GET /portal/keys` (session): the global signing secret.
- `GET /portal/export?page=1` (session + signature): `{ data: [ ...all meters ], total }`.
- `GET /portal/dts?page=N` (session): `{ data: [ ...transformers ], total }`, 20 per page; paged until `total` is reached (40 DTs over 2 pages).
- `GET /portal/meters/{id}/energy` (session): `{ data: [ ...readings ] }`, no query parameters, a fixed window.

## Response shapes the service reads

Values are taken exactly as sent; nothing is renamed and numbers that arrive as strings stay strings.

- Export meter (10 fields): `meterId`, `serialNo`, `make`, `phaseType`, `installStatus`, `installType`, `build`, `dtCode`, `hierarchy` (nested `zone/circle/division/subdivision/substation/feeder/dt`, each `{ name, code }`), and `geo` (`{ lat, lng }` as numbers).
- Transformer (DT): `{ code, name, feederCode, capacityKva }`.
- Energy reading: `{ timestamp, kwh, kvah, voltR }`, and all four are strings. Timestamp format is `DD/MM/YYYY HH:mm` with no timezone.

## Rate limiting

- The portal rate-limits in bursts: a run of requests succeeds, then a block returns HTTP 429 `{"error":"rate_limited",...}`, then it recovers after a cooldown.
- There is no `Retry-After` header and no `x-ratelimit-*` headers on the 429, so there is no server hint to honour.
- Fast-retrying a 429 just produces more 429s. The service instead:
  - does not fast-retry a 429 (it returns immediately rather than hammering),
  - keeps request concurrency at 4 or fewer,
  - retries only the rate-limited items in later passes after a ~20 second cooldown.
- (inferred) The limit is roughly a request count per window (around 115 requests) rather than a concurrency cap.
