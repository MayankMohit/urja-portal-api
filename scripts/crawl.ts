import 'dotenv/config';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/lib/config.js';
import { PortalClient } from '../src/portal/client.js';
import { RecordingLogger } from '../src/lib/recording-logger.js';
import { fetchEnergy } from '../src/sync/fetch.js';
import type { RawDt, RawEnergy, RawExport } from '../src/portal/types.js';

// Writes the raw, untouched portal responses to data/raw/ for the offline audit
// and for building test fixtures. data/ is gitignored.
//
// Resumable by default: an existing export.json/dts.json is reused, and only
// meters whose energy file is missing are fetched. Each energy file is written
// the instant it arrives, so an interrupted run loses nothing and a re-run
// continues where it stopped. This is a rate-limit recovery convenience, NOT the
// freshness mechanism: the background sync (src/sync) decides staleness by
// refetching and comparing content hashes. For a clean full pull that ignores
// whatever is on disk, run `npm run crawl -- --fresh`.
//
// The /portal/keys response (the signing secret) is never written.

// `npm run crawl -- --fresh` refetches everything, ignoring cached files on disk.
const FRESH = process.argv.includes('--fresh');

const RAW_DIR = path.resolve('data/raw');
const ENERGY_DIR = path.join(RAW_DIR, 'energy');

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function readJsonIfExists<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new RecordingLogger();
  const client = new PortalClient(config, logger);

  await mkdir(ENERGY_DIR, { recursive: true });
  const startedAt = Date.now();

  if (FRESH) console.log('--fresh: ignoring cached files, refetching everything.');

  // 1. Backbone: reuse if already saved (unless --fresh), otherwise fetch and save.
  let exportData = FRESH ? null : await readJsonIfExists<RawExport>(path.join(RAW_DIR, 'export.json'));
  let dts = FRESH ? null : await readJsonIfExists<RawDt[]>(path.join(RAW_DIR, 'dts.json'));
  if (exportData && dts) {
    console.log('Reusing existing export.json and dts.json.');
  } else {
    console.log('Fetching signed export and all DTs...');
    exportData = await client.getExport();
    await writeJson(path.join(RAW_DIR, 'export.json'), exportData);
    dts = await client.getTransformers();
    await writeJson(path.join(RAW_DIR, 'dts.json'), dts);
  }

  // 2. Energy: fetch only the meters we do not already have on disk (all, if --fresh).
  const allIds = exportData.data.map((m) => m.meterId);
  const missing: string[] = [];
  for (const id of allIds) {
    if (FRESH || !(await fileExists(path.join(ENERGY_DIR, `${id}.json`)))) missing.push(id);
  }
  console.log(
    `${allIds.length - missing.length}/${allIds.length} energy files already present; ` +
      `fetching ${missing.length} missing at 4 concurrent.`,
  );

  const energy = await fetchEnergy(client, missing, {
    // Save each file immediately so progress survives an interruption.
    onResult: async (id, value: RawEnergy) => {
      await writeJson(path.join(ENERGY_DIR, `${id}.json`), value);
    },
    log: (m) => console.log(m),
  });

  // 3. Summarise this run.
  let fetchedOk = 0;
  const failures: Record<string, string> = {};
  for (const [id, value] of energy) {
    if (value instanceof Error) failures[id] = value.message;
    else fetchedOk++;
  }
  const stillMissing = missing.length - fetchedOk;
  const finishedAt = Date.now();

  await writeJson(path.join(RAW_DIR, 'crawl-log.json'), {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    meterCount: allIds.length,
    dtCount: dts.length,
    energyPresentBefore: allIds.length - missing.length,
    energyFetchedThisRun: fetchedOk,
    energyStillMissing: stillMissing,
    failures,
    requests: logger.entries, // per-request method/path/status/ms/attempt, incl. 429 details
  });

  console.log(
    `Crawl done in ${((finishedAt - startedAt) / 1000).toFixed(1)}s: ` +
      `${allIds.length} meters, ${dts.length} DTs, ` +
      `${fetchedOk} fetched this run, ${stillMissing} still missing.`,
  );
  if (stillMissing > 0) {
    console.log('Some meters are still rate-limited. Re-run `npm run crawl` to fetch the rest.');
  }
  console.log(`Raw data in ${RAW_DIR}. The /portal/keys response was NOT written.`);
}

main().catch((err) => {
  console.error('Crawl failed:', err);
  process.exitCode = 1;
});
