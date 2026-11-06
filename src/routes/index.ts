import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { meterRoutes } from './meters.js';
import { transformerRoutes } from './transformers.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(meterRoutes);
  await app.register(transformerRoutes);
}
