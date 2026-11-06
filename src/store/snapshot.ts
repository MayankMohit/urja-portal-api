import type {
  DataQualityIssue,
  NetworkTreeNode,
  NormalizedMeter,
  NormalizedReading,
  NormalizedTransformer,
  NetworkPathNode,
} from '../domain/types.js';

export interface SnapshotMeter {
  meter: NormalizedMeter;
  networkPath: NetworkPathNode[];
  readings: NormalizedReading[];
  intervalMinutes: number | null;
  readingsStatus: 'ok' | 'stale' | 'unavailable';
}

export interface SyncFailure {
  meterId: string;
  error: string;
}

export interface SyncChanged {
  export: boolean;
  dts: boolean;
  energy: number;
}

// Summary of the most recent sync attempt.
export interface SyncStatus {
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'partial' | 'failed';
  meterCount: number;
  energyOk: number;
  energyFailed: number;
  failures: SyncFailure[];
  changed: SyncChanged;
  error?: string;
}

export interface ResponseHashes {
  export: string;
  dts: string;
  energy: Record<string, string>;
}

export interface Snapshot {
  syncedAt: string;
  dataAsOf: string | null;
  meters: Map<string, SnapshotMeter>;
  transformers: Map<string, NormalizedTransformer>;
  tree: NetworkTreeNode[];
  issues: DataQualityIssue[];
  metersByDt: Map<string, string[]>;
  sync: SyncStatus;
  hashes: ResponseHashes;
}

export function indexMetersByDt(meters: Map<string, SnapshotMeter>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [meterId, entry] of meters) {
    const dt = entry.meter.dtCode;
    const list = index.get(dt);
    if (list) list.push(meterId);
    else index.set(dt, [meterId]);
  }
  return index;
}

export function computeDataAsOf(meters: Map<string, SnapshotMeter>): string | null {
  let latest: string | null = null;
  for (const entry of meters.values()) {
    const last = entry.readings[entry.readings.length - 1];
    if (last && (latest === null || last.timestamp > latest)) {
      latest = last.timestamp;
    }
  }
  return latest;
}

export class SnapshotStore {
  private snapshot: Snapshot | null = null;

  get(): Snapshot | null {
    return this.snapshot;
  }

  replace(snapshot: Snapshot): void {
    this.snapshot = snapshot;
  }

  isReady(): boolean {
    return this.snapshot !== null;
  }
}
