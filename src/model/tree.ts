import type { Relation, SkillNode, TreeDoc } from "./schema";

/** ツリーを引くための索引。TreeDoc が変わるたびに作り直す（不変データとして扱う）。 */
export interface TreeIndex {
  doc: TreeDoc;
  byId: Map<string, SkillNode>;
  /** parentId → 子 ID。ルートは null キー。並びは doc.nodes の順。 */
  children: Map<string | null, string[]>;
  relationsByNode: Map<string, Relation[]>;
}

export function indexTree(doc: TreeDoc): TreeIndex {
  const byId = new Map<string, SkillNode>();
  const children = new Map<string | null, string[]>();
  const relationsByNode = new Map<string, Relation[]>();
  for (const n of doc.nodes) byId.set(n.id, n);
  for (const n of doc.nodes) {
    const parent = n.parentId !== null && byId.has(n.parentId) ? n.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(n.id);
    children.set(parent, list);
  }
  for (const r of doc.relations) {
    for (const end of [r.from, r.to]) {
      const list = relationsByNode.get(end) ?? [];
      list.push(r);
      relationsByNode.set(end, list);
    }
  }
  return { doc, byId, children, relationsByNode };
}

export function childrenOf(ix: TreeIndex, parentId: string | null): SkillNode[] {
  return (ix.children.get(parentId) ?? []).map((id) => ix.byId.get(id)!);
}

/** ルートから id の親までの祖先（id 自身は含まない）。循環があっても止まる。 */
export function ancestorsOf(ix: TreeIndex, id: string): SkillNode[] {
  const out: SkillNode[] = [];
  const seen = new Set<string>([id]);
  let cur = ix.byId.get(id)?.parentId ?? null;
  while (cur !== null && !seen.has(cur)) {
    const node = ix.byId.get(cur);
    if (!node) break;
    out.unshift(node);
    seen.add(cur);
    cur = node.parentId;
  }
  return out;
}

/** id 自身とその子孫の ID。 */
export function subtreeIds(ix: TreeIndex, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(ix.children.get(cur) ?? []));
  }
  return out;
}

export function isGroup(node: SkillNode | undefined): boolean {
  return node?.kind === "group";
}
