import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import scalarApiReference from '@scalar/fastify-api-reference';

const DESCRIPTION = [
  'A clean, read-only API over the legacy Urja Meter Ops portal, which has no API of its own.',
  '',
  'The service syncs everything from the portal in the background, normalizes it, and holds an',
  'immutable in-memory snapshot. Every request here is served from that snapshot; no request ever',
  'reaches the portal. List responses carry `meta.syncedAt` (when the snapshot was fetched) and',
  '`meta.dataAsOf` (the latest reading timestamp), so a consumer always knows how fresh the data is.',
  '',
  'Before the first sync finishes, data routes return `503 snapshot_unavailable`. Unknown ids return',
  '`404 not_found`; invalid parameters return `400 bad_request`. Every error uses the envelope',
  '`{ error: { code, message, details? } }`.',
].join('\n');

export async function registerDocs(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Urja Meter Ops API',
        description: DESCRIPTION,
        version: '1.0.0',
      },
      servers: [{ url: '/', description: 'This service' }],
      components: {
        securitySchemes: {
          // Only POST /sync is protected. It is sent as the X-API-Key header and
          // enforced only when API_KEY is configured on the server.
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      },
      tags: [
        { name: 'health', description: 'Service and snapshot health.' },
        { name: 'meters', description: 'Smart meters: list, detail and interval readings.' },
        { name: 'transformers', description: 'Distribution transformers (DTs) and the meters on each.' },
        { name: 'network', description: 'The repaired network hierarchy tree.' },
        { name: 'data-quality', description: 'Issues found while normalizing the portal data.' },
        { name: 'sync', description: 'Sync status and manual trigger.' },
      ],
    },
  });

  await app.register(scalarApiReference, { routePrefix: '/docs' });

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
}
