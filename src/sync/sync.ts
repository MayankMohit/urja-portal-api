import type { PortalClient } from '../portal/client.js';
import type { DataQualityIssue, NormalizedReading } from '../domain/types.js';
import { normalizeMeter } from '../domain/meters.js';
import { normalizeReadings } from '../domain/readings.js';
import { buildNetwork } from '../domain/hierarchy.js';
import { makeIssue } from '../domain/issues.js';
import type { Snapshot, SnapshotMeter, SnapshotStore, SyncFailure, SyncStatus } from '../store/snapshot.js';
import { computeDataAsOf, indexMetersByDt } from '../store/snapshot.js';
import { saveSnapshot } from '../store/persistence.js';
import { fetchAll } from './fetch.js';

export interface SyncLogger {
  info(msg: string): void;
  error(msg: string): void;
}

function countChangedEnergy(previous: Snapshot | null, next: Record<string, string>): number {
  if (!previous) return Object.keys(next).length;
  let changed = 0;
  for (const [meterId, hash] of Object.entries(next)) {
    if (previous.hashes.energy[meterId] !== hash) changed++;
  }
  return changed;
}

export async function runSync(
  client: PortalClient,
  store: SnapshotStore,
  logger?: SyncLogger,
): Promise<SyncStatus> {
  const startedAt = new Date().toISOString();
  const previous = store.get();

  let fetched;
  try {
    fetched = await fetchAll(client, { log: (m) => logger?.info(m) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.error(`Sync aborted, keeping previous snapshot: ${message}`);
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      meterCount: previous?.meters.size ?? 0,
      energyOk: 0,
      energyFailed: 0,
      failures: [],
      changed: { export: false, dts: false, energy: 0 },
      error: message,
    };
  }

  const issues: DataQualityIssue[] = [];

  const network = buildNetwork(fetched.export.data, fetched.dts);
  issues.push(...network.issues);

  const meters = new Map<string, SnapshotMeter>();
  const failures: SyncFailure[] = [];
  const mergedEnergyHashes: Record<string, string> = {};
  let energyOk = 0;

  for (const rawMeter of fetched.export.data) {
    const { meter, issues: meterIssues } = normalizeMeter(rawMeter);
    issues.push(...meterIssues);
    const networkPath = network.meterPaths.get(meter.meterId) ?? [];

    const energy = fetched.energy.get(meter.meterId);
    let readings: NormalizedReading[];
    let intervalMinutes: number | null;
    let readingsStatus: SnapshotMeter['readingsStatus'];

    if (energy && !(energy instanceof Error)) {
      const normalized = normalizeReadings(meter.meterId, energy);
      readings = normalized.readings;
      intervalMinutes = normalized.intervalMinutes;
      readingsStatus = 'ok';
      issues.push(...normalized.issues);
      mergedEnergyHashes[meter.meterId] = fetched.hashes.energy[meter.meterId]!;
      energyOk++;
    } else {
      const reason = energy instanceof Error ? energy.message : 'no response';
      failures.push({ meterId: meter.meterId, error: reason });
      const prev = previous?.meters.get(meter.meterId);
      if (prev && prev.readings.length > 0) {
        // Keep the last good readings rather than blank out the meter.
        readings = prev.readings;
        intervalMinutes = prev.intervalMinutes;
        readingsStatus = 'stale';
        issues.push(
          makeIssue({
            code: 'readings_stale',
            severity: 'warning',
            entityType: 'meter',
            entityId: meter.meterId,
            message: `Energy fetch failed this sync (${reason}); serving the previous snapshot's readings.`,
          }),
        );
        const prevHash = previous?.hashes.energy[meter.meterId];
        if (prevHash) mergedEnergyHashes[meter.meterId] = prevHash;
      } else {
        readings = [];
        intervalMinutes = null;
        readingsStatus = 'unavailable';
        issues.push(
          makeIssue({
            code: 'readings_unavailable',
            severity: 'error',
            entityType: 'meter',
            entityId: meter.meterId,
            message: `Energy fetch failed this sync (${reason}) and no previous readings exist.`,
          }),
        );
      }
    }

    meters.set(meter.meterId, { meter, networkPath, readings, intervalMinutes, readingsStatus });
  }

  const transformers = new Map(network.transformers.map((t) => [t.code, t]));
  const hashes = { export: fetched.hashes.export, dts: fetched.hashes.dts, energy: mergedEnergyHashes };
  const energyFailed = failures.length;

  const syncStatus: SyncStatus = {
    startedAt,
    finishedAt: new Date().toISOString(),
    status: energyFailed > 0 ? 'partial' : 'ok',
    meterCount: meters.size,
    energyOk,
    energyFailed,
    failures,
    changed: {
      export: previous ? previous.hashes.export !== hashes.export : true,
      dts: previous ? previous.hashes.dts !== hashes.dts : true,
      energy: countChangedEnergy(previous, mergedEnergyHashes),
    },
  };

  const snapshot: Snapshot = {
    syncedAt: startedAt,
    dataAsOf: computeDataAsOf(meters),
    meters,
    transformers,
    tree: network.tree,
    issues,
    metersByDt: indexMetersByDt(meters),
    sync: syncStatus,
    hashes,
  };

  store.replace(snapshot);
  try {
    await saveSnapshot(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.error(`Snapshot is live in memory but failed to persist to disk: ${message}`);
  }

  logger?.info(
    `Sync ${syncStatus.status}: ${energyOk} energy ok, ${energyFailed} failed, ` +
      `data as of ${snapshot.dataAsOf ?? 'n/a'}`,
  );
  return syncStatus;
}
