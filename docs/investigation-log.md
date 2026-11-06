# Investigation log

How I figured out the Urja Meter Ops portal and built the API over it.
All times IST. Investigation was Thursday 5 November 2026; the build ran from 5 to 6 November.

Tools I used: Chrome DevTools (Network tab with Preserve log on, Sources search, Console), curl in Git Bash, and small throwaway counting scripts.

## Part 1: reading the portal (5 Nov morning)

- **09:15** Saw the login cookie `__Secure-better-auth.session_token`, so the portal uses Better Auth. Found the "Export all meters" button. It only exports meter details, not consumption.
- **09:20** Watched a login in the Network tab. It is a form POST (not JSON), needs an `Origin` header, and the reply sets a cookie that lasts 1 hour (`Max-Age=3600`). The hashed script bundles and `__data.json` requests told me the app is SvelteKit.
- **09:45** Confirmed the login field names (`email`, `password`) in the Payload tab. Looked at the energy (readings) response: every value is a string, timestamps look like `DD/MM/YYYY`, and the kWh numbers only go up (they are running totals, not per-reading amounts).
- **09:50** Clicking Export calls `/portal/keys` first, then `/portal/export?page=1`. Studied the 403-meter export and spotted: a `build` field (legacy vs v2), some blank hierarchy values, the same codes reused in different branches, one transformer (DT-007) with two names, and geo points spread wider than expected.
- **10:15** Read the Transformers page JavaScript. The export is signed with HMAC-SHA256 using `x-timestamp` and `x-signature` headers. Also found `/portal/dts` (the transformer list) and `/portal/meters/search`.
- **10:30** Tested the signing in the browser console: no headers fails, a correct signature works, a wrong one fails, timestamps up to about 5 minutes old or new are accepted, and the secret is the same across sessions. Also noticed `page` in the export is ignored (it always returns all 403). Saw that hovering a link preloads its data, which is just noise when tracing.
- **10:45** J100011's detail page shows a blank circle code too, so the blanks are missing at the source, not something I broke.
- **10:55** With curl: no cookie, a junk cookie, or an unsigned export all return `401 unauthorized` as JSON. The session is checked before the signature.
- **11:15** More curl login tests: with `Origin` I get 200 and a cookie; without `Origin` I get 403; a wrong password returns **200** (not 401) with `type: failure` in the body. So the HTTP status alone does not tell you if login worked, the body does.
- **11:30** An old token was rejected by the server, which proves the 1 hour limit is enforced server-side, not just in the browser. The signing secret was identical in two separate sessions, so it is global.

## Part 2: what the full data crawl showed (5 Nov afternoon)

- Ran the full crawl once (all 403 meters plus the export and transformer list), at most 4 requests at a time to be gentle.
- The portal rate-limits in bursts: a batch of requests works, then it returns `429` for a while, then recovers. There is **no** `Retry-After` or rate-limit header to follow, so the only option is to wait and retry later.
- Fix that worked: stop fast-retrying a 429, and re-fetch the few meters that failed in a later pass after a short cooldown. The second run finished with nothing missing.
- Corrected an early wrong guess: not every meter reports every 30 minutes. Exactly 40 meters (J100000 to J100039, one per transformer) are 30-minute; the rest report once a day. Daily is the norm.
- Found one real defect: 5 meters have a duplicated last row where some values are blank. Keeping the first row on a duplicate timestamp cleans this up.
- Confirmed the hierarchy: 22 blank values can be filled from other meters on the same transformer, and DT-007 really does carry an old name ("Old Malviya Nagar Xfmr") alongside its current one.

## Part 3: building the API (5 to 6 Nov)

- Chose a "sync then serve" design: pull everything from the portal once, clean it up, keep it in memory, and answer every request from that copy. Requests never touch the portal.
- Built it in layers: portal client (login, signing, retries) -> normalizers (clean timestamps, numbers, enums, hierarchy) -> snapshot store and background sync -> API routes -> OpenAPI docs.
- Tested the signing against a known-good value, and the routes with fake in-memory data so the tests make zero live calls.
- Left the read API open. Protected only `POST /sync` (the one action that hits the portal) with an `X-API-Key`, plus a short cooldown so it cannot be spammed.
