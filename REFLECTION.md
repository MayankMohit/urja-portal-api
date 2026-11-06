# Reflection

**What assumptions did you make?**
- Timestamps are in IST. The data has no timezone, but the meters are in Jaipur and daily readings land at midnight local time.
- The data is frozen. Readings stop on 30 June and do not change, which is what made caching and incremental syncing safe.
- The bulk export is the source of truth for meter details, and the transformer list is the source of truth for transformer names.
- A normal voltage band is 230 V ±6%.
- kWh and kVAh are running totals, so real usage is the difference between two readings.
- Two numbers I measured but the portal never states: the signing time window (about ±300 seconds) and the rate limit (about 120 requests per 60-second window).

---

**Which part was the most difficult, and how did you get unstuck?**

The portal's rate limiting. It limits in bursts, sends no `Retry-After`, and a naive full crawl always failed on the same back third of the meters. I was briefly confused because waiting longer before starting did not help. The unlock was realizing two things: the data is frozen, so I never need to refetch a meter I already have; and the limiter resets on about a 60-second window and lets ~120 through per burst. Making the sync incremental (fetch only missing meters) and setting the retry cooldown to ~60 seconds made a cold fetch finish in about 3 minutes and steady-state syncs almost free. Discovering the signed export was also tricky; I found the HMAC scheme by reading the Transformers page's JavaScript and then confirmed the exact string-to-sign and the time window in the browser console.

---

**If you had another day, what would you improve?**

Add proper unit tests for the cleaning rules and the hierarchy repair. Build the frontend (consumption and voltage charts, a status map, a hierarchy explorer, a data-quality view, etc.). Make the sync auto-converge after a partial run instead of waiting for the next scheduled one. And sketch the database version (time-series DB, incremental reads, geo index) for real scale.

---

**What mistake did you make while solving this?**

I first assumed most meters report every 30 minutes, generalizing from the first meter (J100000). The full crawl proved that wrong: only 40 meters are 30-minute, one per transformer, and the other 358 are daily. I also initially had the two meter-detail formats (legacy vs v2) the wrong way round, and expected a JSON login endpoint when it was actually a SvelteKit form action.

---

**If you were reviewing your own submission, what would you criticise?**

My biggest criticism is scalability. The whole dataset lives in memory and every sync rebuilds the full snapshot, so it works well for this size (a few hundred meters, a week of readings) but would not hold up for a very large utility. Making it scale would not be a small tweak; it would mean changing the architecture quite a bit (moving to a time-series database, fetching only new readings, indexing geo properly, and running syncs per meter or transformer instead of one big job). Given the two-day time budget I think the in-memory design is a reasonable trade-off, but I am aware it is the first thing that would have to change for real scale.

---