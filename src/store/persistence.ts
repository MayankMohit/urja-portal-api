import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DataQualityIssue, NetworkTreeNode, NormalizedTransformer } from '../domain/types.js';
import type { ResponseHashes, Snapshot, SnapshotMeter, SyncStatus } from './snapshot.js';
import { computeDataAsOf, indexMetersByDt } from './snapshot.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const SNAPSHOT_PATH = path.join(DATA_DIR, 'snapshot.json');
const TEMP_PATH = `${SNAPSHOT_PATH}.tmp`;

interface SerializedSnapshot {
  version: 1;
  syncedAt: string;
  dataAsOf: string | null;
  meters: SnapshotMeter[];
  transformers: NormalizedTransformer[];
  tree: NetworkTreeNode[];
  issues: DataQualityIssue[];
  sync: SyncStatus;
  hashes: ResponseHashes;
}

function serialize(snapshot: Snapshot): SerializedSnapshot {
  return {
    version: 1,
    syncedAt: snapshot.syncedAt,
    dataAsOf: snapshot.dataAsOf,
    meters: [...snapshot.meters.values()],
    transformers: [...snapshot.transformers.values()],
    tree: snapshot.tree,
    issues: snapshot.issues,
    sync: snapshot.sync,
    hashes: snapshot.hashes,
  };
}

function deserialize(raw: SerializedSnapshot): Snapshot {
  const meters = new Map<string, SnapshotMeter>();
  for (const entry of raw.meters) meters.set(entry.meter.meterId, entry);
  const transformers = new Map<string, NormalizedTransformer>();
  for (const t of raw.transformers) transformers.set(t.code, t);

  return {
    syncedAt: raw.syncedAt,
    dataAsOf: raw.dataAsOf ?? computeDataAsOf(meters),
    meters,
    transformers,
    tree: raw.tree,
    issues: raw.issues,
    metersByDt: indexMetersByDt(meters),
    sync: raw.sync,
    hashes: raw.hashes,
  };
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const indent = process.env.NODE_ENV === 'production' ? undefined : 2;
  await writeFile(TEMP_PATH, JSON.stringify(serialize(snapshot), null, indent), 'utf8');
  await rename(TEMP_PATH, SNAPSHOT_PATH);
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  let text: string;
  try {
    text = await readFile(SNAPSHOT_PATH, 'utf8');
  } catch {
    return null;
  }
  try {
    return deserialize(JSON.parse(text) as SerializedSnapshot);
  } catch {
    return null;
  }
}
