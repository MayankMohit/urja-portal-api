import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    // Extra response headers to send with this error, e.g. Retry-After on a 429.
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  body(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const snapshotUnavailable = (): ApiError =>
  new ApiError(
    503,
    'snapshot_unavailable',
    'No snapshot is available yet; the first sync has not completed. Retry shortly.',
  );

export const notFound = (message: string, details?: Record<string, unknown>): ApiError =>
  new ApiError(404, 'not_found', message, details);

export const badRequest = (message: string, details?: Record<string, unknown>): ApiError =>
  new ApiError(400, 'bad_request', message, details);

export const unauthorized = (message: string): ApiError =>
  new ApiError(401, 'unauthorized', message);

export const forbidden = (message: string, code = 'forbidden'): ApiError =>
  new ApiError(403, code, message);

export const rateLimited = (message: string, retryAfterSeconds: number): ApiError =>
  new ApiError(429, 'rate_limited', message, { retryAfterSeconds }, {
    'retry-after': String(retryAfterSeconds),
  });

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) {
      if (error.headers) reply.headers(error.headers);
      reply.status(error.statusCode).send(error.body());
      return;
    }

    if (error.validation) {
      reply.status(400).send({
        error: {
          code: 'bad_request',
          message: 'Request validation failed.',
          details: { validation: error.validation },
        },
      } satisfies ApiErrorBody);
      return;
    }

    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error in request');
      reply.status(500).send({
        error: { code: 'internal_error', message: 'An unexpected error occurred.' },
      } satisfies ApiErrorBody);
      return;
    }

    reply.status(statusCode).send({
      error: { code: error.code ?? 'error', message: error.message },
    } satisfies ApiErrorBody);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'not_found',
        message: `Route ${request.method} ${request.url} not found.`,
      },
    } satisfies ApiErrorBody);
  });
}
