import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { NormalizedMeter, NormalizedTransformer } from '../domain/types.js';
import { notFound } from '../lib/api-errors.js';
import { listMeta, meta, requireSnapshot } from '../lib/envelope.js';
import {
  TransformerDetailResponse,
  TransformerParams,
  TransformersListResponse,
} from '../schemas/transformers.js';

function toSummary(t: NormalizedTransformer) {
  return {
    code: t.code,
    name: t.name,
    aliases: t.aliases,
    feederCode: t.feederCode,
    capacityKva: t.capacityKva,
    meterCount: t.meterCount,
    networkPath: t.networkPath ?? [],
  };
}

function toMeterSummary(m: NormalizedMeter) {
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
  };
}

export async function transformerRoutes(appRaw: FastifyInstance): Promise<void> {
  const app = appRaw.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/transformers',
    { schema: { tags: ['transformers'], summary: 'List all transformers', response: { 200: TransformersListResponse } } },
    async () => {
      const snapshot = requireSnapshot(app.store);
      const data = [...snapshot.transformers.values()]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map(toSummary);
      return { data, meta: listMeta(snapshot, 1, data.length, data.length) };
    },
  );

  app.get(
    '/transformers/:code',
    { schema: { tags: ['transformers'], summary: 'Get one transformer with its meters', params: TransformerParams, response: { 200: TransformerDetailResponse } } },
    async (request) => {
      const snapshot = requireSnapshot(app.store);
      const { code } = request.params;
      const transformer = snapshot.transformers.get(code);
      if (!transformer) throw notFound(`No transformer with code "${code}".`);

      const meterIds = snapshot.metersByDt.get(code) ?? [];
      const meters = meterIds
        .map((id) => snapshot.meters.get(id))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
        .map((entry) => toMeterSummary(entry.meter))
        .sort((a, b) => a.meterId.localeCompare(b.meterId));

      const data = {
        ...toSummary(transformer),
        meters,
      };

      return { data, meta: meta(snapshot) };
    },
  );
}
