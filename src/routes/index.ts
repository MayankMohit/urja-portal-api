import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { meterRoutes } from './meters.js';
import { transformerRoutes } from './transformers.js';
import { networkRoutes } from './network.js';
import { dataQualityRoutes } from './data-quality.js';
import { syncRoutes } from './sync.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(meterRoutes);
  await app.register(transformerRoutes);
  await app.register(networkRoutes);
  await app.register(dataQualityRoutes);
  await app.register(syncRoutes);
}
