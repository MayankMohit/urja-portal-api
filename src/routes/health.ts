import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { Nullable } from '../schemas/common.js';

const SyncStatusLiteral = Type.Union([
  Type.Literal('ok'),
  Type.Literal('partial'),
  Type.Literal('failed'),
]);

const HealthResponse = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
  portal: Type.Object({
    reachable: Nullable(Type.Boolean()),
    lastLoginAt: Nullable(Type.String()),
    sessionAgeSeconds: Nullable(Type.Number()),
  }),
  snapshot: Nullable(
    Type.Object({
      syncedAt: Type.String(),
      dataAsOf: Nullable(Type.String()),
      meterCount: Type.Integer(),
      lastSyncStatus: Nullable(SyncStatusLiteral),
    }),
  ),
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { schema: { tags: ['health'], summary: 'Service and snapshot health', response: { 200: HealthResponse } } }, async () => {
    const snap = app.store.get();
    const last = app.scheduler.getLastStatus();
    const session = app.client.getSessionInfo();
    const now = Date.now();

    const lastSyncStatus = last?.status ?? snap?.sync.status ?? null;
    const reachable = last ? last.status !== 'failed' : null;

    const portal = {
      reachable,
      lastLoginAt: session.loggedInAt ? new Date(session.loggedInAt).toISOString() : null,
      sessionAgeSeconds: session.loggedInAt ? Math.round((now - session.loggedInAt) / 1000) : null,
    };

    const snapshot = snap
      ? {
          syncedAt: snap.syncedAt,
          dataAsOf: snap.dataAsOf,
          meterCount: snap.meters.size,
          lastSyncStatus,
        }
      : null;

    const status = snap && lastSyncStatus !== 'failed' ? 'ok' : 'degraded';

    return { status, portal, snapshot };
  });
}
