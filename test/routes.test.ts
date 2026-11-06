import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './support.js';

describe('routes (seeded snapshot)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function get(url: string) {
    const res = await app.inject({ method: 'GET', url });
    return { status: res.statusCode, body: res.json() };
  }

  describe('GET /api/v1/health', () => {
    it('reports ok with a snapshot summary', async () => {
      const { status, body } = await get('/api/v1/health');
      expect(status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.snapshot.meterCount).toBe(2);
      expect(body.snapshot.lastSyncStatus).toBe('ok');
    });
  });

  describe('GET /api/v1/meters', () => {
    it('lists all meters with list meta', async () => {
      const { status, body } = await get('/api/v1/meters');
      expect(status).toBe(200);
      expect(body.meta.total).toBe(2);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].meterId).toBe('J100000');
    });

    it('filters by make', async () => {
      const { body } = await get('/api/v1/meters?make=genus');
      expect(body.meta.total).toBe(1);
      expect(body.data[0].meterId).toBe('J100001');
    });

    it('filters by transformer code', async () => {
      const { body } = await get('/api/v1/meters?transformer=DT-001');
      expect(body.meta.total).toBe(2);
    });

    it('adds distanceKm and sorts when near is given', async () => {
      const { body } = await get('/api/v1/meters?near=26.9389,75.8309');
      expect(body.data[0].distanceKm).toBeTypeOf('number');
    });

    it('rejects an unknown enum value with 400', async () => {
      const { status, body } = await get('/api/v1/meters?status=zzz');
      expect(status).toBe(400);
      expect(body.error.code).toBe('bad_request');
    });

    it('rejects a malformed near with 400', async () => {
      const { status, body } = await get('/api/v1/meters?near=999,0');
      expect(status).toBe(400);
      expect(body.error.code).toBe('bad_request');
    });
  });

  describe('GET /api/v1/meters/:meterId', () => {
    it('returns the full meter with network path', async () => {
      const { status, body } = await get('/api/v1/meters/J100000');
      expect(status).toBe(200);
      expect(body.data.networkPath).toHaveLength(7);
      expect(body.data.readingsSummary.count).toBe(3);
      expect(body.data.aliases).toContain('Old Malviya Nagar Xfmr');
    });

    it('includes the meter issues', async () => {
      const { body } = await get('/api/v1/meters/J100001');
      expect(body.data.issues).toHaveLength(1);
      expect(body.data.issues[0].code).toBe('hierarchy_value_repaired');
    });

    it('returns 404 for an unknown meter', async () => {
      const { status, body } = await get('/api/v1/meters/NOPE');
      expect(status).toBe(404);
      expect(body.error.code).toBe('not_found');
    });
  });

  describe('GET /api/v1/meters/:meterId/readings', () => {
    it('returns readings and a summary', async () => {
      const { status, body } = await get('/api/v1/meters/J100000/readings');
      expect(status).toBe(200);
      expect(body.data.readings).toHaveLength(3);
      expect(body.data.summary.totalKwh).toBeCloseTo(0.92);
      expect(body.data.summary.outOfBandCount).toBe(1);
      expect(body.data.summary.voltageBand.min).toBeCloseTo(216.2);
    });

    it('windows by from and to', async () => {
      const { body } = await get(
        '/api/v1/meters/J100000/readings?from=2026-06-24T00:00:00%2B05:30',
      );
      expect(body.data.readings).toHaveLength(2);
    });

    it('rejects a bad from with 400', async () => {
      const { status, body } = await get('/api/v1/meters/J100000/readings?from=notadate');
      expect(status).toBe(400);
      expect(body.error.code).toBe('bad_request');
    });
  });

  describe('GET /api/v1/transformers', () => {
    it('lists transformers', async () => {
      const { status, body } = await get('/api/v1/transformers');
      expect(status).toBe(200);
      expect(body.meta.total).toBe(1);
      expect(body.data[0].code).toBe('DT-001');
      expect(body.data[0].networkPath).toHaveLength(6);
    });

    it('returns a transformer with its meters', async () => {
      const { status, body } = await get('/api/v1/transformers/DT-001');
      expect(status).toBe(200);
      expect(body.data.meters).toHaveLength(2);
      expect(body.data.aliases).toContain('Old Malviya Nagar Xfmr');
    });

    it('returns 404 for an unknown transformer', async () => {
      const { status, body } = await get('/api/v1/transformers/DT-999');
      expect(status).toBe(404);
      expect(body.error.code).toBe('not_found');
    });
  });

  describe('GET /api/v1/network', () => {
    it('returns the full tree', async () => {
      const { status, body } = await get('/api/v1/network');
      expect(status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].level).toBe('zone');
      expect(body.data[0].children[0].level).toBe('circle');
    });

    it('trims to the requested depth', async () => {
      const { body } = await get('/api/v1/network?depth=1');
      expect(body.data[0].children).toHaveLength(0);
    });

    it('rejects a non-numeric depth with 400', async () => {
      const { status, body } = await get('/api/v1/network?depth=deep');
      expect(status).toBe(400);
      expect(body.error.code).toBe('bad_request');
    });
  });

  describe('GET /api/v1/data-quality', () => {
    it('returns all issues with counts by code', async () => {
      const { status, body } = await get('/api/v1/data-quality');
      expect(status).toBe(200);
      expect(body.data.total).toBe(2);
      expect(body.data.countsByCode.hierarchy_value_repaired).toBe(1);
      expect(body.data.countsByCode.reading_duplicate_timestamp).toBe(1);
    });

    it('filters by severity', async () => {
      const { body } = await get('/api/v1/data-quality?severity=info');
      expect(body.data.total).toBe(1);
      expect(body.data.issues[0].code).toBe('hierarchy_value_repaired');
    });

    it('filters by entityType', async () => {
      const { body } = await get('/api/v1/data-quality?entityType=reading');
      expect(body.data.total).toBe(1);
    });

    it('filters by code', async () => {
      const { body } = await get('/api/v1/data-quality?code=hierarchy_value_repaired');
      expect(body.data.total).toBe(1);
    });

    it('rejects an invalid severity with 400', async () => {
      const { status, body } = await get('/api/v1/data-quality?severity=critical');
      expect(status).toBe(400);
      expect(body.error.code).toBe('bad_request');
    });
  });

  describe('GET /api/v1/sync/status', () => {
    it('returns the last sync summary', async () => {
      const { status, body } = await get('/api/v1/sync/status');
      expect(status).toBe(200);
      expect(body.data.status).toBe('ok');
      expect(body.data.meterCount).toBe(2);
      expect(body.data.energyFailed).toBe(1);
    });
  });
});

describe('routes (no snapshot)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(false);
  });

  afterAll(async () => {
    await app.close();
  });

  it('health reports degraded with no snapshot', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('degraded');
    expect(res.json().snapshot).toBeNull();
  });

  it('data routes return 503 before the first sync', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/meters' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('snapshot_unavailable');
  });
});

describe('docs', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(false);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the OpenAPI spec with every route', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toHaveLength(10);
  });

  it('serves the Scalar docs UI', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});
