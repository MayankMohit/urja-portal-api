import { Type } from '@sinclair/typebox';
import { IssueSchema, Meta } from './common.js';

const SeveritySchema = Type.Union([
  Type.Literal('info'),
  Type.Literal('warning'),
  Type.Literal('error'),
]);
const EntityTypeSchema = Type.Union([
  Type.Literal('meter'),
  Type.Literal('transformer'),
  Type.Literal('reading'),
]);

export const DataQualityQuery = Type.Object({
  code: Type.Optional(Type.String()),
  severity: Type.Optional(SeveritySchema),
  entityType: Type.Optional(EntityTypeSchema),
});

export const DataQualityResponse = Type.Object({
  data: Type.Object({
    total: Type.Integer(),
    countsByCode: Type.Record(Type.String(), Type.Integer()),
    issues: Type.Array(IssueSchema),
  }),
  meta: Meta,
});
