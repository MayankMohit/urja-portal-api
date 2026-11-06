import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { forbidden, unauthorized } from './api-errors.js';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireApiKey(config: Config) {
  return async function apiKeyGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!config.apiKey) {
      throw forbidden(
        'This endpoint is disabled because API_KEY is not configured on the server.',
        'sync_disabled',
      );
    }

    const provided = request.headers['x-api-key'];
    const value = Array.isArray(provided) ? provided[0] : provided;
    if (!value || !safeEqual(value, config.apiKey)) {
      throw unauthorized('A valid X-API-Key header is required for this endpoint.');
    }
  };
}
