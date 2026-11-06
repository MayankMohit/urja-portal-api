import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { NetworkTreeNode } from '../domain/types.js';
import { meta, requireSnapshot } from '../lib/envelope.js';
import { NetworkQuery, NetworkResponse } from '../schemas/network.js';

function trim(node: NetworkTreeNode, depth: number): NetworkTreeNode {
  return {
    ...node,
    children: depth <= 1 ? [] : node.children.map((child) => trim(child, depth - 1)),
  };
}

export async function networkRoutes(appRaw: FastifyInstance): Promise<void> {
  const app = appRaw.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/network',
    { schema: { querystring: NetworkQuery, response: { 200: NetworkResponse } } },
    async (request) => {
      const snapshot = requireSnapshot(app.store);
      const { depth } = request.query;
      const data = depth === undefined ? snapshot.tree : snapshot.tree.map((n) => trim(n, depth));
      return { data, meta: meta(snapshot) };
    },
  );
}
