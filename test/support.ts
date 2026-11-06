import type { FastifyInstance } from 'fastify';
import type { Config } from '../src/lib/config.js';
import { buildApp } from '../src/app.js';
import type {
  DataQualityIssue,
  HierarchyLevel,
  NetworkPathNode,
  NormalizedMeter,
  NormalizedReading,
  NormalizedTransformer,
} from '../src/domain/types.js';
import type { Snapshot, SnapshotMeter, SyncStatus } from '../src/store/snapshot.js';

const TEST_CONFIG: Config = {
  portalUrl: 'http://localhost',
  portalEmail: 'test@example.com',
  portalPassword: 'password',
  host: '127.0.0.1',
  port: 0,
  syncIntervalHours: 6,
};

const LEVELS: { level: HierarchyLevel; code: string; name: string }[] = [
  { level: 'zone', code: 'Z-01', name: 'Jaipur Zone 1' },
  { level: 'circle', code: 'C-01', name: 'Circle 1' },
  { level: 'division', code: 'D-01', name: 'Division 1' },
  { level: 'subdivision', code: 'SD-01', name: 'Subdivision 1' },
  { level: 'substation', code: 'SS-01', name: 'Substation 1' },
  { level: 'feeder', code: 'F-001', name: 'Feeder 1' },
  { level: 'dt', code: 'DT-001', name: 'Malviya Nagar DT 1' },
];

function meterPath(): NetworkPathNode[] {
  const segments: string[] = [];
  return LEVELS.map(({ level, code, name }) => {
    segments.push(code);
    return { level, id: segments.join('/'), code, name };
  });
}

function rawHierarchy(): NormalizedMeter['rawHierarchy'] {
  const h = {} as NormalizedMeter['rawHierarchy'];
  for (const { level, code, name } of LEVELS) h[level] = { code, name };
  return h;
}

function meter(overrides: Partial<NormalizedMeter>): NormalizedMeter {
  return {
    meterId: 'J100000',
    serialNo: 'SE33962',
    make: 'HPL',
    phase: 'single',
    status: 'installed',
    installType: 'whole_current',
    build: 'legacy',
    dtCode: 'DT-001',
    geo: { lat: 26.9389, lng: 75.8309 },
    rawHierarchy: rawHierarchy(),
    ...overrides,
  };
}

const READINGS: NormalizedReading[] = [
  {
    timestamp: '2026-06-23T23:30:00+05:30',
    kwhRegister: 48438.74,
    kvahRegister: 52313.84,
    voltageR: 226,
    kwh: null,
    kvah: null,
    powerFactor: null,
    gapBefore: false,
  },
  {
    timestamp: '2026-06-24T00:00:00+05:30',
    kwhRegister: 48439.16,
    kvahRegister: 52314.29,
    voltageR: 229,
    kwh: 0.42,
    kvah: 0.45,
    powerFactor: 0.933,
    gapBefore: false,
  },
  {
    timestamp: '2026-06-24T00:30:00+05:30',
    kwhRegister: 48439.66,
    kvahRegister: 52314.84,
    voltageR: 250,
    kwh: 0.5,
    kvah: 0.55,
    powerFactor: 0.909,
    gapBefore: false,
  },
];

function makeSnapshot(): Snapshot {
  const meters = new Map<string, SnapshotMeter>();
  meters.set('J100000', {
    meter: meter({ meterId: 'J100000' }),
    networkPath: meterPath(),
    readings: READINGS,
    intervalMinutes: 30,
    readingsStatus: 'ok',
  });
  meters.set('J100001', {
    meter: meter({
      meterId: 'J100001',
      serialNo: 'GE10001',
      make: 'Genus',
      phase: 'three',
      status: 'faulty',
      installType: 'ct_operated',
      build: 'v2',
    }),
    networkPath: meterPath(),
    readings: [],
    intervalMinutes: null,
    readingsStatus: 'unavailable',
  });

  const transformer: NormalizedTransformer = {
    code: 'DT-001',
    name: 'Malviya Nagar DT 1',
    aliases: ['Old Malviya Nagar Xfmr'],
    feederCode: 'F-001',
    capacityKva: 100,
    meterCount: 2,
    networkPath: meterPath().slice(0, 6),
  };

  const issues: DataQualityIssue[] = [
    {
      code: 'hierarchy_value_repaired',
      severity: 'info',
      entityType: 'meter',
      entityId: 'J100001',
      field: 'circle.code',
      message: 'circle code was blank at source; repaired from sibling meters.',
      originalValue: '',
      repairedValue: 'C-01',
    },
  ];

  const sync: SyncStatus = {
    startedAt: '2026-11-05T19:38:18.570Z',
    finishedAt: '2026-11-05T19:39:00.000Z',
    status: 'ok',
    meterCount: 2,
    energyOk: 1,
    energyFailed: 1,
    failures: [],
    changed: { export: true, dts: true, energy: 2 },
  };

  return {
    syncedAt: '2026-11-05T19:38:18.570Z',
    dataAsOf: '2026-06-24T00:30:00+05:30',
    meters,
    transformers: new Map([['DT-001', transformer]]),
    tree: [],
    issues,
    metersByDt: new Map([['DT-001', ['J100000', 'J100001']]]),
    sync,
    hashes: { export: 'x', dts: 'y', energy: {} },
  };
}

export async function buildTestApp(seed = true): Promise<FastifyInstance> {
  const { app } = await buildApp({ config: TEST_CONFIG });
  if (seed) app.store.replace(makeSnapshot());
  await app.ready();
  return app;
}
