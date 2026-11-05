import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import type { PortalClient } from '../portal/client.js';
import type { RawDt, RawEnergy, RawExport } from '../portal/types.js';

// Everything one crawl/sync pulls from the portal, plus a content hash per
// response so we can tell later whether anything actually changed.
export interface FetchAllResult {
  export: RawExport;
  dts: RawDt[];
  energy: Map<string, RawEnergy | Error>;
  hashes: {
    export: string;
    dts: string;
    energy: Record<string, string>;
  };
}

// Be gentle with the portal: at most 4 energy requests in flight at once.
const ENERGY_CONCURRENCY = 4;
// The portal rate-limits in bursts; after a block of 429s it recovers. So a
// failed meter is retried in a later pass after a cooldown, not hammered now.
const ENERGY_PASSES = 5;
const ENERGY_COOLDOWN_MS = 20_000;

export interface FetchEnergyOptions {
  concurrency?: number;
  passes?: number;
  cooldownMs?: number;
  // Called as soon as a meter succeeds, so callers can save incrementally and
  // never lose progress if the run is interrupted.
  onResult?: (meterId: string, value: RawEnergy) => void | Promise<void>;
  // Optional progress line sink (e.g. console.log).
  log?: (message: string) => void;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A failure we should retry in a later pass (transient rate limit), vs a
// permanent error we should leave as-is.
function isRateLimited(err: Error): boolean {
  return /\b429\b|rate.?limit/i.test(err.message);
}

// Fetch energy for the given meters, retrying only the rate-limited ones across
// several cooldown-spaced passes. Returns a map of meterId -> readings or the
// final Error. Shared by the crawl script and the background sync.
export async function fetchEnergy(
  client: PortalClient,
  meterIds: string[],
  options: FetchEnergyOptions = {},
): Promise<Map<string, RawEnergy | Error>> {
  const concurrency = options.concurrency ?? ENERGY_CONCURRENCY;
  const passes = options.passes ?? ENERGY_PASSES;
  const cooldownMs = options.cooldownMs ?? ENERGY_COOLDOWN_MS;

  const results = new Map<string, RawEnergy | Error>();
  let pending = [...meterIds];

  for (let pass = 1; pass <= passes && pending.length > 0; pass++) {
    if (pass > 1) {
      options.log?.(
        `Pass ${pass}: ${pending.length} meter(s) rate-limited last pass, ` +
          `waiting ${cooldownMs / 1000}s for the limit to reset...`,
      );
      await delay(cooldownMs);
    }

    const limit = pLimit(concurrency);
    const retryNext: string[] = [];

    await Promise.all(
      pending.map((id) =>
        limit(async () => {
          try {
            const value = await client.getEnergy(id);
            results.set(id, value);
            await options.onResult?.(id, value);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            results.set(id, error);
            // Only rate-limit failures are worth another pass; keep real errors.
            if (isRateLimited(error)) retryNext.push(id);
          }
        }),
      ),
    );

    pending = retryNext;
  }

  return results;
}

// Pull the full dataset: the signed export, all transformer pages, then energy
// for every meter (with the cooldown retry passes above).
export async function fetchAll(
  client: PortalClient,
  options: FetchEnergyOptions = {},
): Promise<FetchAllResult> {
  const exportData = await client.getExport();
  const dts = await client.getTransformers();

  const meterIds = exportData.data.map((m) => m.meterId);
  const energy = await fetchEnergy(client, meterIds, options);

  const energyHashes: Record<string, string> = {};
  for (const [id, value] of energy) {
    if (!(value instanceof Error)) energyHashes[id] = hashJson(value);
  }

  return {
    export: exportData,
    dts,
    energy,
    hashes: { export: hashJson(exportData), dts: hashJson(dts), energy: energyHashes },
  };
}
