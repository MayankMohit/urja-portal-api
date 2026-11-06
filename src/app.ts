import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Config } from './lib/config.js';
import { PortalClient } from './portal/client.js';
import { SnapshotStore } from './store/snapshot.js';
import { SyncScheduler } from './sync/scheduler.js';
import { registerErrorHandler } from './lib/api-errors.js';
import { registerDocs } from './lib/openapi.js';
import { registerRoutes } from './routes/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    store: SnapshotStore;
    client: PortalClient;
    scheduler: SyncScheduler;
  }
}

export interface BuildAppOptions {
  config: Config;
  logger?: FastifyServerOptions['logger'];
}

export interface BuiltApp {
  app: FastifyInstance;
  scheduler: SyncScheduler;
}

export async function buildApp({ config, logger = false }: BuildAppOptions): Promise<BuiltApp> {
  const app = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>();

  const store = new SnapshotStore();
  const client = new PortalClient(config, {
    debug: (obj, msg) => app.log.debug(obj, msg),
  });
  const scheduler = new SyncScheduler({
    client,
    store,
    intervalHours: config.syncIntervalHours,
    logger: {
      info: (msg) => app.log.info(msg),
      error: (msg) => app.log.error(msg),
    },
  });

  app.decorate('config', config);
  app.decorate('store', store);
  app.decorate('client', client);
  app.decorate('scheduler', scheduler);

  registerErrorHandler(app);

  await registerDocs(app);
  await app.register(registerRoutes, { prefix: '/api/v1' });

  return { app, scheduler };
}
