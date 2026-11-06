import { Type } from '@sinclair/typebox';
import { HierarchyLevelSchema, Meta, Nullable } from './common.js';

export const NetworkQuery = Type.Object({
  depth: Type.Optional(
    Type.Integer({ minimum: 1, description: 'Levels to include from the root; omit for the full tree.' }),
  ),
});

// A node in the repaired network tree. Recursive: each node carries its children.
export const NetworkTreeNodeSchema = Type.Recursive(
  (Self) =>
    Type.Object({
      id: Type.String(),
      level: HierarchyLevelSchema,
      code: Nullable(Type.String()),
      name: Nullable(Type.String()),
      meterCount: Type.Integer(),
      children: Type.Array(Self),
    }),
  { $id: 'NetworkTreeNode' },
);

export const NetworkResponse = Type.Object({
  data: Type.Array(NetworkTreeNodeSchema),
  meta: Meta,
});
