import { Type, type TSchema } from '@sinclair/typebox';

// A value that may also be null. The portal data has genuine nulls (repaired
// meters, missing readings) and we want to preserve them in the API.
export const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

// Meta block on a single-resource response.
export const Meta = Type.Object({
  syncedAt: Type.String({ description: 'When this snapshot was fetched from the portal.' }),
  dataAsOf: Nullable(Type.String({ description: 'Latest reading timestamp across all meters.' })),
});

// Meta block on a paginated list response.
export const ListMeta = Type.Object({
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
  syncedAt: Type.String(),
  dataAsOf: Nullable(Type.String()),
});

// The single error envelope every failure uses
export const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
});

// Shared domain schemas, reused across the meter, transformer, network and
// data-quality routes. The enums mirror the normalized domain types exactly.

export const Geo = Type.Object({ lat: Type.Number(), lng: Type.Number() });

export const HierarchyLevelSchema = Type.Union([
  Type.Literal('zone'),
  Type.Literal('circle'),
  Type.Literal('division'),
  Type.Literal('subdivision'),
  Type.Literal('substation'),
  Type.Literal('feeder'),
  Type.Literal('dt'),
]);

export const NetworkPathNodeSchema = Type.Object({
  level: HierarchyLevelSchema,
  id: Type.String({ description: 'Full code path, e.g. Z-01/C-01/D-01/.../DT-001.' }),
  code: Nullable(Type.String()),
  name: Nullable(Type.String()),
  repaired: Type.Optional(Type.Boolean()),
});

export const StatusSchema = Type.Union([
  Type.Literal('installed'),
  Type.Literal('faulty'),
  Type.Literal('decommissioned'),
]);
export const PhaseSchema = Type.Union([Type.Literal('single'), Type.Literal('three')]);
export const InstallTypeSchema = Type.Union([
  Type.Literal('whole_current'),
  Type.Literal('ct_operated'),
]);
export const BuildSchema = Type.Union([Type.Literal('legacy'), Type.Literal('v2')]);

// Per-meter readings availability: fresh, carried over from a failed sync, or
// never fetched.
export const ReadingsStatusSchema = Type.Union([
  Type.Literal('ok'),
  Type.Literal('stale'),
  Type.Literal('unavailable'),
]);

export const IssueSchema = Type.Object({
  code: Type.String(),
  severity: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  entityType: Type.Union([
    Type.Literal('meter'),
    Type.Literal('transformer'),
    Type.Literal('reading'),
  ]),
  entityId: Type.String(),
  field: Type.Optional(Type.String()),
  message: Type.String(),
  originalValue: Type.Optional(Type.Unknown()),
  repairedValue: Type.Optional(Type.Unknown()),
});
