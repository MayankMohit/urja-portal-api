import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { meta, requireSnapshot } from '../lib/envelope.js';
import { DataQualityQuery, DataQualityResponse } from '../schemas/data-quality.js';

export async function dataQualityRoutes(appRaw: FastifyInstance): Promise<void> {
  const app = appRaw.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/data-quality',
    { schema: { tags: ['data-quality'], summary: 'List data-quality issues with counts by code', querystring: DataQualityQuery, response: { 200: DataQualityResponse } } },
    async (request) => {
      const snapshot = requireSnapshot(app.store);
      const { code, severity, entityType } = request.query;

      const issues = snapshot.issues.filter(
        (i) =>
          (code === undefined || i.code === code) &&
          (severity === undefined || i.severity === severity) &&
          (entityType === undefined || i.entityType === entityType),
      );

      // Counts over the filtered set, so the counts match what is returned.
      const countsByCode: Record<string, number> = {};
      for (const i of issues) countsByCode[i.code] = (countsByCode[i.code] ?? 0) + 1;

      return {
        data: { total: issues.length, countsByCode, issues },
        meta: meta(snapshot),
      };
    },
  );
}
