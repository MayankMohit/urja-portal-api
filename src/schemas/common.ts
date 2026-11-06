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
