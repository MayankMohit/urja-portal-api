# Investigation log

How I reverse-engineered the Urja Meter Ops portal. All times IST, Thursday 5 November 2026.

Methods: Chrome DevTools (Network tab with Preserve log, Sources search, Console), curl in WSL/Git Bash, and small Python/JS counting scripts. No tokens, secrets, or credentials are recorded here.

- **09:15** Found the cookie `__Secure-better-auth.session_token` and recognised Better Auth. Found the "Export all meters" button and saw it exports meter attributes only, no consumption.
- **09:20** Captured `POST /login` headers: form-urlencoded, `Accept: application/json`, `Origin`, `Content-Length: 50`, a 53-byte response, `Max-Age=3600`. Saw `__data.json?x-sveltekit-invalidated` and hashed bundles, so the app is SvelteKit. Found `/portal/meters/{id}/energy` (JSON) and the hierarchy breadcrumb.
- **09:45** Confirmed the login field names in the DevTools Payload tab. Inspected the energy JSON: values are strings, timestamps are `DD/MM/YYYY`, and the registers are cumulative.
- **09:50** Observed the export fires `/portal/keys` and then `/portal/export?page=1`. Analysed the 403-meter export: the `build` field, blank hierarchy values, code reuse across branches, the DT-007 name conflict, and the geo spread.
- **10:15** Read the Transformers page JS and found the HMAC-SHA256 signing with `x-timestamp` and `x-signature`. Found `/portal/dts` and `/portal/meters/search`. Compared v2 (J100013) vs legacy nameplate labels.
- **10:30** Worked out the SvelteKit hover preloading (noise when tracing). Compared `__data.json` for legacy and v2 (two formats) and matched them against the export. Ran console tests of the signing scheme: no headers, a valid signature, a bad signature, 60/300/900 s old timestamps, `page=2`, and secret stability. Checked the geo endpoint shape. Found that J100400 has daily readings.
- **10:45** J100011's detail page confirmed that the circle code is missing at the source, not dropped by me. Signed out and back in.
- **10:55** curl: no cookie, a garbage cookie, `/portal/keys`, and the export without a cookie all returned 401 `unauthorized` as JSON.
- **11:15** curl login tests: with `Origin` returned 200 plus a cookie; without `Origin` returned 403; a wrong password returned 200 with `type: failure`.
- **11:30** An old token was rejected by the server, confirming a hard 1 hour expiry server-side. The signing secret was identical across two sessions. The signature window is about +/- 300 s.
