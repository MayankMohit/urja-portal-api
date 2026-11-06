import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { meta, requireSnapshot } from '../lib/envelope.js';
import { SyncStatusResponse, SyncTriggerResponse } from '../schemas/sync.js';

export async function syncRoutes(appRaw: FastifyInstance): Promise<void> {
  const app = appRaw.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/sync/status',
    { schema: { tags: ['sync'], summary: 'Get the last sync summary', response: { 200: SyncStatusResponse } } },
    async () => {
      const snapshot = requireSnapshot(app.store);
      const data = app.scheduler.getLastStatus() ?? snapshot.sync;
      return { data, meta: meta(snapshot) };
    },
  );

  app.post(
    '/sync',
    { schema: { tags: ['sync'], summary: 'Trigger a sync (fire-and-forget, returns 202)', response: { 202: SyncTriggerResponse } } },
    async (_request, reply) => {
      const alreadyRunning = app.scheduler.isSyncing();
      void app.scheduler
        .triggerSync()
        .catch((err) => app.log.error({ err }, 'Manually triggered sync failed'));
      const snapshot = app.store.get();
      reply.code(202);
      return {
        data: { accepted: true, alreadyRunning, startedAt: new Date().toISOString() },
        meta: snapshot ? meta(snapshot) : null,
      };
    },
  );
}
