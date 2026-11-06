import type { SnapshotStore, Snapshot } from '../store/snapshot.js';
import { snapshotUnavailable } from './api-errors.js';

export interface Meta {
  syncedAt: string;
  dataAsOf: string | null;
}

export interface ListMeta extends Meta {
  page: number;
  pageSize: number;
  total: number;
}

// Return the live snapshot or throw 503 if the first sync has not finished.
// Every data route starts with this so none of them has to null-check by hand.
export function requireSnapshot(store: SnapshotStore): Snapshot {
  const snapshot = store.get();
  if (!snapshot) throw snapshotUnavailable();
  return snapshot;
}

// Meta for a single-resource response.
export function meta(snapshot: Snapshot): Meta {
  return { syncedAt: snapshot.syncedAt, dataAsOf: snapshot.dataAsOf };
}

// Meta for a paginated list response.
export function listMeta(
  snapshot: Snapshot,
  page: number,
  pageSize: number,
  total: number,
): ListMeta {
  return { page, pageSize, total, syncedAt: snapshot.syncedAt, dataAsOf: snapshot.dataAsOf };
}
