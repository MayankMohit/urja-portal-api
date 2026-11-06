import { Type } from '@sinclair/typebox';
import {
  BuildSchema,
  Geo,
  InstallTypeSchema,
  IssueSchema,
  ListMeta,
  Meta,
  NetworkPathNodeSchema,
  Nullable,
  PhaseSchema,
  ReadingsStatusSchema,
  StatusSchema,
} from './common.js';

// ---------------------------------------------------------------------------
// GET /api/v1/meters
// ---------------------------------------------------------------------------

export const MetersQuery = Type.Object({
  status: Type.Optional(StatusSchema),
  make: Type.Optional(Type.String()),
  phase: Type.Optional(PhaseSchema),
  installType: Type.Optional(InstallTypeSchema),
  build: Type.Optional(BuildSchema),
  zone: Type.Optional(Type.String()),
  circle: Type.Optional(Type.String()),
  division: Type.Optional(Type.String()),
  subdivision: Type.Optional(Type.String()),
  substation: Type.Optional(Type.String()),
  feeder: Type.Optional(Type.String()),
  transformer: Type.Optional(Type.String({ description: 'DT code, e.g. DT-001.' })),
  q: Type.Optional(Type.String({ description: 'Case-insensitive substring of meter id or serial.' })),
  near: Type.Optional(
    Type.String({
      pattern: '^-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?$',
      description: 'lat,lng. Adds distanceKm and sorts by distance.',
    }),
  ),
  radiusKm: Type.Optional(Type.Number({ minimum: 0 })),
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});

export const MeterSummary = Type.Object({
  meterId: Type.String(),
  serialNo: Type.String(),
  make: Type.String(),
  phase: PhaseSchema,
  status: StatusSchema,
  installType: InstallTypeSchema,
  build: BuildSchema,
  dtCode: Type.String(),
  geo: Geo,
  distanceKm: Type.Optional(Type.Number()),
});

export const MetersListResponse = Type.Object({
  data: Type.Array(MeterSummary),
  meta: ListMeta,
});

// ---------------------------------------------------------------------------
// GET /api/v1/meters/:meterId
// ---------------------------------------------------------------------------

export const MeterParams = Type.Object({
  meterId: Type.String(),
});

export const MeterDetail = Type.Object({
  meterId: Type.String(),
  serialNo: Type.String(),
  make: Type.String(),
  phase: PhaseSchema,
  status: StatusSchema,
  installType: InstallTypeSchema,
  build: BuildSchema,
  dtCode: Type.String(),
  geo: Geo,
  networkPath: Type.Array(NetworkPathNodeSchema),
  aliases: Type.Array(Type.String()),
  readingsSummary: Type.Object({
    intervalMinutes: Nullable(Type.Integer()),
    status: ReadingsStatusSchema,
    count: Type.Integer(),
    first: Nullable(Type.String()),
    last: Nullable(Type.String()),
  }),
  issues: Type.Array(IssueSchema),
});

export const MeterDetailResponse = Type.Object({
  data: MeterDetail,
  meta: Meta,
});

// ---------------------------------------------------------------------------
// GET /api/v1/meters/:meterId/readings
// ---------------------------------------------------------------------------

export const ReadingsQuery = Type.Object({
  from: Type.Optional(Type.String({ description: 'ISO 8601 lower bound (inclusive).' })),
  to: Type.Optional(Type.String({ description: 'ISO 8601 upper bound (inclusive).' })),
  nominalVoltage: Type.Optional(Type.Number({ minimum: 1, default: 230 })),
  tolerancePct: Type.Optional(Type.Number({ minimum: 0, maximum: 100, default: 6 })),
});

export const Reading = Type.Object({
  timestamp: Type.String(),
  kwhRegister: Nullable(Type.Number()),
  kvahRegister: Nullable(Type.Number()),
  voltageR: Nullable(Type.Number()),
  kwh: Nullable(Type.Number()),
  kvah: Nullable(Type.Number()),
  powerFactor: Nullable(Type.Number()),
  gapBefore: Type.Boolean(),
});

export const ReadingsSummary = Type.Object({
  count: Type.Integer(),
  totalKwh: Type.Number(),
  minVoltage: Nullable(Type.Number()),
  maxVoltage: Nullable(Type.Number()),
  avgVoltage: Nullable(Type.Number()),
  outOfBandCount: Type.Integer(),
  voltageBand: Type.Object({
    min: Type.Number(),
    max: Type.Number(),
    nominal: Type.Number(),
    tolerancePct: Type.Number(),
  }),
});

export const ReadingsResponse = Type.Object({
  data: Type.Object({
    meterId: Type.String(),
    intervalMinutes: Nullable(Type.Integer()),
    readingsStatus: ReadingsStatusSchema,
    readings: Type.Array(Reading),
    summary: ReadingsSummary,
  }),
  meta: Meta,
});
