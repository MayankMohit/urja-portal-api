import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Static } from '@sinclair/typebox';
import type { HierarchyLevel, NetworkPathNode, NormalizedMeter } from '../domain/types.js';
import type { SnapshotMeter } from '../store/snapshot.js';
import { badRequest, notFound } from '../lib/api-errors.js';
import { listMeta, meta, requireSnapshot } from '../lib/envelope.js';
import { distanceKm } from '../lib/geo.js';
import {
  MeterParams,
  MeterDetailResponse,
  MetersListResponse,
  MetersQuery,
  ReadingsQuery,
  ReadingsResponse,
} from '../schemas/meters.js';

type MetersQueryT = Static<typeof MetersQuery>;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Map a meter's network path to a level -> code lookup, for the hierarchy filters.
function codeByLevel(path: NetworkPathNode[]): Partial<Record<HierarchyLevel, string | null>> {
  const out: Partial<Record<HierarchyLevel, string | null>> = {};
  for (const node of path) out[node.level] = node.code;
  return out;
}

function parseNear(raw: string): { lat: number; lng: number } {
  const [latStr, lngStr] = raw.split(',');
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw badRequest(`Invalid near "${raw}"; expected lat,lng with lat in [-90,90] and lng in [-180,180].`);
  }
  return { lat, lng };
}

function matchesFilters(entry: SnapshotMeter, query: MetersQueryT): boolean {
  const m = entry.meter;
  if (query.status && m.status !== query.status) return false;
  if (query.make && m.make.toLowerCase() !== query.make.toLowerCase()) return false;
  if (query.phase && m.phase !== query.phase) return false;
  if (query.installType && m.installType !== query.installType) return false;
  if (query.build && m.build !== query.build) return false;
  if (query.transformer && m.dtCode !== query.transformer) return false;

  const byLevel = codeByLevel(entry.networkPath);
  if (query.zone && byLevel.zone !== query.zone) return false;
  if (query.circle && byLevel.circle !== query.circle) return false;
  if (query.division && byLevel.division !== query.division) return false;
  if (query.subdivision && byLevel.subdivision !== query.subdivision) return false;
  if (query.substation && byLevel.substation !== query.substation) return false;
  if (query.feeder && byLevel.feeder !== query.feeder) return false;

  if (query.q) {
    const needle = query.q.toLowerCase();
    if (!m.meterId.toLowerCase().includes(needle) && !m.serialNo.toLowerCase().includes(needle)) {
      return false;
    }
  }
  return true;
}

function toSummary(m: NormalizedMeter, distance: number | null) {
  return {
    meterId: m.meterId,
    serialNo: m.serialNo,
    make: m.make,
    phase: m.phase,
    status: m.status,
    installType: m.installType,
    build: m.build,
    dtCode: m.dtCode,
    geo: m.geo,
    ...(distance !== null ? { distanceKm: round3(distance) } : {}),
  };
}

// Parse an inclusive timestamp bound. Any format Date.parse understands is
// accepted (date or full ISO); anything else is a 400.
function parseBound(raw: string | undefined, name: string): number | null {
  if (raw === undefined) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw badRequest(`Invalid ${name} timestamp "${raw}".`);
  return ms;
}

export async function meterRoutes(appRaw: FastifyInstance): Promise<void> {
  const app = appRaw.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/meters',
    { schema: { querystring: MetersQuery, response: { 200: MetersListResponse } } },
    async (request) => {
      const snapshot = requireSnapshot(app.store);
      const query = request.query;
      const near = query.near !== undefined ? parseNear(query.near) : null;

      let rows = [...snapshot.meters.values()]
        .filter((entry) => matchesFilters(entry, query))
        .map((entry) => ({
          meter: entry.meter,
          distance: near ? distanceKm(near.lat, near.lng, entry.meter.geo.lat, entry.meter.geo.lng) : null,
        }));

      if (near) {
        if (query.radiusKm !== undefined) rows = rows.filter((r) => r.distance! <= query.radiusKm!);
        rows.sort((a, b) => a.distance! - b.distance!);
      } else {
        rows.sort((a, b) => a.meter.meterId.localeCompare(b.meter.meterId));
      }

      const total = rows.length;
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const start = (page - 1) * pageSize;
      const data = rows.slice(start, start + pageSize).map((r) => toSummary(r.meter, r.distance));

      return { data, meta: listMeta(snapshot, page, pageSize, total) };
    },
  );

  app.get(
    '/meters/:meterId',
    { schema: { params: MeterParams, response: { 200: MeterDetailResponse } } },
    async (request) => {
      const snapshot = requireSnapshot(app.store);
      const { meterId } = request.params;
      const entry = snapshot.meters.get(meterId);
      if (!entry) throw notFound(`No meter with id "${meterId}".`);

      const m = entry.meter;
      const transformer = snapshot.transformers.get(m.dtCode);
      const readings = entry.readings;
      const issues = snapshot.issues.filter((i) => i.entityId === meterId);

      const data = {
        meterId: m.meterId,
        serialNo: m.serialNo,
        make: m.make,
        phase: m.phase,
        status: m.status,
        installType: m.installType,
        build: m.build,
        dtCode: m.dtCode,
        geo: m.geo,
        networkPath: entry.networkPath,
        aliases: transformer?.aliases ?? [],
        readingsSummary: {
          intervalMinutes: entry.intervalMinutes,
          status: entry.readingsStatus,
          count: readings.length,
          first: readings[0]?.timestamp ?? null,
          last: readings[readings.length - 1]?.timestamp ?? null,
        },
        issues,
      };

      return { data, meta: meta(snapshot) };
    },
  );

  app.get(
    '/meters/:meterId/readings',
    { schema: { params: MeterParams, querystring: ReadingsQuery, response: { 200: ReadingsResponse } } },
    async (request) => {
      const snapshot = requireSnapshot(app.store);
      const { meterId } = request.params;
      const entry = snapshot.meters.get(meterId);
      if (!entry) throw notFound(`No meter with id "${meterId}".`);

      const fromMs = parseBound(request.query.from, 'from');
      const toMs = parseBound(request.query.to, 'to');

      let readings = entry.readings;
      if (fromMs !== null || toMs !== null) {
        readings = readings.filter((r) => {
          const t = Date.parse(r.timestamp);
          if (fromMs !== null && t < fromMs) return false;
          if (toMs !== null && t > toMs) return false;
          return true;
        });
      }

      const nominal = request.query.nominalVoltage ?? 230;
      const tolerancePct = request.query.tolerancePct ?? 6;
      const bandMin = nominal * (1 - tolerancePct / 100);
      const bandMax = nominal * (1 + tolerancePct / 100);

      let totalKwh = 0;
      let minVoltage: number | null = null;
      let maxVoltage: number | null = null;
      let voltageSum = 0;
      let voltageCount = 0;
      let outOfBandCount = 0;

      for (const r of readings) {
        if (r.kwh !== null) totalKwh += r.kwh;
        if (r.voltageR !== null) {
          voltageCount++;
          voltageSum += r.voltageR;
          minVoltage = minVoltage === null ? r.voltageR : Math.min(minVoltage, r.voltageR);
          maxVoltage = maxVoltage === null ? r.voltageR : Math.max(maxVoltage, r.voltageR);
          if (r.voltageR < bandMin || r.voltageR > bandMax) outOfBandCount++;
        }
      }

      const data = {
        meterId,
        intervalMinutes: entry.intervalMinutes,
        readingsStatus: entry.readingsStatus,
        readings,
        summary: {
          count: readings.length,
          totalKwh: round3(totalKwh),
          minVoltage,
          maxVoltage,
          avgVoltage: voltageCount > 0 ? round3(voltageSum / voltageCount) : null,
          outOfBandCount,
          voltageBand: {
            min: round3(bandMin),
            max: round3(bandMax),
            nominal,
            tolerancePct,
          },
        },
      };

      return { data, meta: meta(snapshot) };
    },
  );
}
