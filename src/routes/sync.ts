import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { meta, requireSnapshot } from '../lib/envelope.js';
import { SyncStatusResponse } from '../schemas/sync.js';

export async function syncRoutes(appRaw: FastifyInstance): Promise<void> {
  const app = appRaw.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/sync/status',
    { schema: { response: { 200: SyncStatusResponse } } },
    async () => {
      const snapshot = requireSnapshot(app.store);
      const data = app.scheduler.getLastStatus() ?? snapshot.sync;
      return { data, meta: meta(snapshot) };
    },
  );
}
