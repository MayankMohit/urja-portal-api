import { Type } from '@sinclair/typebox';
import { ListMeta, Meta, NetworkPathNodeSchema } from './common.js';
import { MeterSummary } from './meters.js';

export const TransformerSummary = Type.Object({
  code: Type.String(),
  name: Type.String(),
  aliases: Type.Array(Type.String()),
  feederCode: Type.String(),
  capacityKva: Type.Number(),
  meterCount: Type.Integer(),
  networkPath: Type.Array(NetworkPathNodeSchema),
});

// ---------------------------------------------------------------------------
// GET /api/v1/transformers
// ---------------------------------------------------------------------------

export const TransformersListResponse = Type.Object({
  data: Type.Array(TransformerSummary),
  meta: ListMeta,
});

// ---------------------------------------------------------------------------
// GET /api/v1/transformers/:code
// ---------------------------------------------------------------------------

export const TransformerParams = Type.Object({
  code: Type.String(),
});

export const TransformerDetailResponse = Type.Object({
  data: Type.Intersect([
    TransformerSummary,
    Type.Object({
      meters: Type.Array(MeterSummary),
    }),
  ]),
  meta: Meta,
});
