import { Type } from '@sinclair/typebox';
import { Meta } from './common.js';

export const SyncStatusSchema = Type.Object({
  startedAt: Type.String(),
  finishedAt: Type.String(),
  status: Type.Union([Type.Literal('ok'), Type.Literal('partial'), Type.Literal('failed')]),
  meterCount: Type.Integer(),
  energyOk: Type.Integer(),
  energyFailed: Type.Integer(),
  failures: Type.Array(Type.Object({ meterId: Type.String(), error: Type.String() })),
  changed: Type.Object({
    export: Type.Boolean(),
    dts: Type.Boolean(),
    energy: Type.Integer(),
  }),
  error: Type.Optional(Type.String()),
});

export const SyncStatusResponse = Type.Object({
  data: SyncStatusSchema,
  meta: Meta,
});
