import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { rateLimited } from '../lib/api-errors.js';
import { requireApiKey } from '../lib/auth.js';
import { meta, requireSnapshot } from '../lib/envelope.js';
import { SyncStatusResponse, SyncTriggerQuery, SyncTriggerResponse } from '../schemas/sync.js';

const MANUAL_SYNC_COOLDOWN_SECONDS = 60;

export async function syncRoutes(appRaw: FastifyInstance): Promise<void> {
  const app = appRaw.withTypeProvider<TypeBoxTypeProvider>();

  // Timestamp of the last crawl this route started, for the cooldown.
  let lastManualTriggerAt = 0;

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
    {
      preHandler: requireApiKey(app.config),
      schema: {
        tags: ['sync'],
        summary: 'Trigger a sync (protected by X-API-Key, fire-and-forget, returns 202)',
        security: [{ apiKey: [] }],
        querystring: SyncTriggerQuery,
        response: { 202: SyncTriggerResponse },
      },
    },
    async (request, reply) => {
      const full = request.query.full ?? false;
      const alreadyRunning = app.scheduler.isSyncing();
      const now = Date.now();

      // Only a request that would start a NEW crawl is subject to the cooldown;
      // one that arrives while a sync is running just joins it (single-flight).
      if (!alreadyRunning) {
        const elapsed = (now - lastManualTriggerAt) / 1000;
        if (lastManualTriggerAt > 0 && elapsed < MANUAL_SYNC_COOLDOWN_SECONDS) {
          const retryAfter = Math.ceil(MANUAL_SYNC_COOLDOWN_SECONDS - elapsed);
          throw rateLimited(
            `A sync was triggered recently; wait ${retryAfter}s before triggering another.`,
            retryAfter,
          );
        }
        lastManualTriggerAt = now;
      }

      void app.scheduler
        .triggerSync({ full })
        .catch((err) => app.log.error({ err }, 'Manually triggered sync failed'));
      const snapshot = app.store.get();
      reply.code(202);
      return {
        data: { accepted: true, alreadyRunning, startedAt: new Date(now).toISOString() },
        meta: snapshot ? meta(snapshot) : null,
      };
    },
  );
}
