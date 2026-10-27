import type { Relation, RelationType, SkillNode, TreeDoc } from "./schema";
import { indexTree, subtreeIds } from "./tree";

// 編集操作。すべて新しい TreeDoc を返し、引数を変更しない。

export function uniqueId(base: string, taken: Set<string>): string {
  const slug = base.trim().replace(/\s+/g, "-") || "node";
  if (!taken.has(slug)) return slug;
  for (let i = 2; ; i++) {
    const candidate = `${slug}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function allIds(doc: TreeDoc): Set<string> {
  return new Set([...doc.nodes, ...doc.relations, ...doc.achievements].map((x) => x.id));
}

export function addNode(
  doc: TreeDoc,
  init: Pick<SkillNode, "kind" | "parentId" | "title"> & Partial<SkillNode>,
): { doc: TreeDoc; id: string } {
  const id = uniqueId(init.id ?? `n-${Date.now().toString(36)}`, allIds(doc));
  return { doc: { ...doc, nodes: [...doc.nodes, { ...init, id }] }, id };
}

export function updateNode(
  doc: TreeDoc,
  id: string,
  patch: Partial<Pick<SkillNode, "title" | "summary" | "unlocks" | "kind">>,
): TreeDoc {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** 親を変える。自分の子孫や分野以外を親にしようとした場合はエラー文を返す。 */
export function setParent(doc: TreeDoc, id: string, parentId: string | null): TreeDoc | string {
  const ix = indexTree(doc);
  if (parentId !== null) {
    const parent = ix.byId.get(parentId);
    if (!parent) return "親が見つかりません";
    if (parent.kind !== "group") return "親にできるのは分野だけです";
    if (subtreeIds(ix, id).has(parentId)) return "自分自身や内部の要素を親にはできません";
  }
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? { ...n, parentId } : n)) };
}

/** ノードとその内部を削除する。関係する線と、対象を失った実績の参照も外す。 */
export function removeNode(doc: TreeDoc, id: string): TreeDoc {
  const gone = subtreeIds(indexTree(doc), id);
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !gone.has(n.id)),
    relations: doc.relations.filter((r) => !gone.has(r.from) && !gone.has(r.to)),
    achievements: doc.achievements.map((a) => ({
      ...a,
      skillIds: a.skillIds.filter((s) => !gone.has(s)),
    })),
  };
}

export function addRelation(
  doc: TreeDoc,
  type: RelationType,
  from: string,
  to: string,
  note?: string,
): { doc: TreeDoc; id: string } | string {
  if (from === to) return "同じノード同士はつなげません";
  if (doc.relations.some((r) => r.type === type && r.from === from && r.to === to)) {
    return "同じ関係がすでにあります";
  }
  const id = uniqueId(`r-${from}-${to}`, allIds(doc));
  const rel: Relation = { id, type, from, to, ...(note ? { note } : {}) };
  return { doc: { ...doc, relations: [...doc.relations, rel] }, id };
}

export function removeRelation(doc: TreeDoc, id: string): TreeDoc {
  return { ...doc, relations: doc.relations.filter((r) => r.id !== id) };
}
