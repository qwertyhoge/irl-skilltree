import { z } from "zod";

// 交換用ツリー定義の正本。描画・レイアウト・個人記録は含めない。

export const SCHEMA_VERSION = 1;

export const LIMITS = {
  nodes: 5000,
  relations: 20000,
  achievements: 5000,
  titleLength: 200,
  textLength: 10000,
} as const;

const id = z.string().min(1).max(200);
const title = z.string().min(1).max(LIMITS.titleLength);
const text = z.string().max(LIMITS.textLength);

export const OriginSchema = z.object({
  treeId: id,
  nodeId: id,
  treeTitle: title.optional(),
});

export const NodeSchema = z.object({
  id,
  kind: z.enum(["group", "skill"]),
  parentId: id.nullable(),
  title,
  summary: text.optional(),
  unlocks: text.optional(),
  origin: OriginSchema.optional(),
});

export const RelationSchema = z.object({
  id,
  type: z.enum(["prerequisite", "related"]),
  from: id,
  to: id,
  note: text.optional(),
  // 部分書き出しで範囲外の端点を参照として残した場合の、その端点の情報
  external: z
    .object({ treeId: id, title: title.optional(), path: z.array(title).optional() })
    .optional(),
});

export const ConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text }),
]);

export const AchievementSchema = z.object({
  id,
  title,
  description: text.optional(),
  skillIds: z.array(id),
  condition: ConditionSchema,
});

export const SourceSchema = z.object({
  treeId: id,
  title: title.optional(),
  note: text.optional(),
});

export const TreeDocSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  title,
  description: text.optional(),
  authors: z.array(z.string().max(LIMITS.titleLength)).optional(),
  sources: z.array(SourceSchema).optional(),
  nodes: z.array(NodeSchema).max(LIMITS.nodes),
  relations: z.array(RelationSchema).max(LIMITS.relations),
  achievements: z.array(AchievementSchema).max(LIMITS.achievements),
});

export type Origin = z.infer<typeof OriginSchema>;
export type SkillNode = z.infer<typeof NodeSchema>;
export type Relation = z.infer<typeof RelationSchema>;
export type RelationType = Relation["type"];
export type Achievement = z.infer<typeof AchievementSchema>;
export type TreeDoc = z.infer<typeof TreeDocSchema>;
