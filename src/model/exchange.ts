import type { Relation, SkillNode, TreeDoc } from "./schema";
import { SCHEMA_VERSION } from "./schema";
import { ancestorsOf, indexTree, subtreeIds } from "./tree";
import { allIds, uniqueId } from "./ops";

// ツリー同士の部分的な受け渡し。参照切れは黙って消さず、必ず報告に載せる。

export type OutsideLinkMode = "drop" | "keep-external";

export interface ExtractReport {
  /** 範囲外とつながっていたため削除した関係 */
  dropped: Relation[];
  /** 範囲外の端点を external 参照として残した関係 */
  keptAsExternal: Relation[];
  /** 対象スキルが範囲外にもあったため、範囲内のスキルだけに絞った実績 */
  trimmedAchievements: string[];
}

/** 一つの枝を独立したツリーとして書き出す。枝の根はルート階層に置く。 */
export function extractBranch(
  doc: TreeDoc,
  rootId: string,
  mode: OutsideLinkMode,
): { doc: TreeDoc; report: ExtractReport } {
  const ix = indexTree(doc);
  const root = ix.byId.get(rootId);
  if (!root) throw new Error(`ノード「${rootId}」がありません`);
  const inside = subtreeIds(ix, rootId);
  const report: ExtractReport = { dropped: [], keptAsExternal: [], trimmedAchievements: [] };

  const relations: Relation[] = [];
  for (const r of doc.relations) {
    const fromIn = inside.has(r.from);
    const toIn = inside.has(r.to);
    if (fromIn && toIn) relations.push(r);
    else if (fromIn || toIn) {
      if (mode === "drop") report.dropped.push(r);
      else {
        const outsideId = fromIn ? r.to : r.from;
        const outside = ix.byId.get(outsideId);
        const kept: Relation = {
          ...r,
          external: {
            treeId: doc.id,
            ...(outside ? { title: outside.title } : {}),
            path: ancestorsOf(ix, outsideId).map((a) => a.title),
          },
        };
        relations.push(kept);
        report.keptAsExternal.push(kept);
      }
    }
  }

  const achievements = doc.achievements.flatMap((a) => {
    const skillIds = a.skillIds.filter((s) => inside.has(s));
    if (skillIds.length === 0) return [];
    if (skillIds.length < a.skillIds.length) report.trimmedAchievements.push(a.title);
    return [{ ...a, skillIds }];
  });

  return {
    doc: {
      schemaVersion: SCHEMA_VERSION,
      id: `${doc.id}--${rootId}`,
      title: root.title,
      ...(root.summary ? { description: root.summary } : {}),
      ...(doc.authors ? { authors: doc.authors } : {}),
      sources: [...(doc.sources ?? []), { treeId: doc.id, title: doc.title }],
      nodes: doc.nodes
        .filter((n) => inside.has(n.id))
        .map((n) => (n.id === rootId ? { ...n, parentId: null } : n)),
      relations,
      achievements,
    },
    report,
  };
}

export interface ImportReport {
  /** 元の ID → 取り込み後の ID（衝突して変えたものを含む全件） */
  idMap: Map<string, string>;
  renamed: { from: string; to: string }[];
  /** 相手が取り込み範囲外のため取り込まなかった関係 */
  skippedRelations: Relation[];
  /** 範囲外の相手が、以前に取り込んだノードとして既にあったためつなぎ直した関係 */
  reconnectedRelations: Relation[];
}

/**
 * source の枝（ルート指定なしなら全体）を target の parentId の下へコピーする。
 * ID が衝突したら付け替え、各ノードに取り込み元（origin）を残す。target は変更しない。
 */
export function importBranch(
  target: TreeDoc,
  source: TreeDoc,
  sourceRootId: string | null,
  parentId: string | null,
): { doc: TreeDoc; report: ImportReport } {
  const six = indexTree(source);
  const inside = new Set<string>();
  if (sourceRootId === null) source.nodes.forEach((n) => inside.add(n.id));
  else {
    if (!six.byId.has(sourceRootId)) throw new Error(`ノード「${sourceRootId}」がありません`);
    subtreeIds(six, sourceRootId).forEach((id) => inside.add(id));
  }
  if (parentId !== null && target.nodes.find((n) => n.id === parentId)?.kind !== "group") {
    throw new Error("取り込み先は分野である必要があります");
  }

  const taken = allIds(target);
  const report: ImportReport = {
    idMap: new Map(),
    renamed: [],
    skippedRelations: [],
    reconnectedRelations: [],
  };
  const assign = (oldId: string) => {
    const newId = uniqueId(oldId, taken);
    taken.add(newId);
    report.idMap.set(oldId, newId);
    if (newId !== oldId) report.renamed.push({ from: oldId, to: newId });
    return newId;
  };

  const picked = source.nodes.filter((n) => inside.has(n.id));
  picked.forEach((n) => assign(n.id));
  const nodes: SkillNode[] = picked.map((n) => ({
    ...n,
    id: report.idMap.get(n.id)!,
    parentId:
      n.parentId !== null && inside.has(n.parentId) ? report.idMap.get(n.parentId)! : parentId,
    // 既に取り込み元を持つノードは、最初の出典を保つ
    origin: n.origin ?? { treeId: source.id, nodeId: n.id, treeTitle: source.title },
  }));

  // 範囲外の相手が、target に同じ出典のノードとして既にあればつなぎ直す
  const byOrigin = new Map<string, string>();
  for (const n of target.nodes)
    if (n.origin?.treeId === source.id) byOrigin.set(n.origin.nodeId, n.id);

  const relations: Relation[] = [];
  for (const r of source.relations) {
    const fromIn = inside.has(r.from);
    const toIn = inside.has(r.to);
    if (!fromIn && !toIn) continue;
    const map = (end: string, isIn: boolean) => (isIn ? report.idMap.get(end) : byOrigin.get(end));
    const from = map(r.from, fromIn);
    const to = map(r.to, toIn);
    if (from === undefined || to === undefined) {
      report.skippedRelations.push(r);
      continue;
    }
    const rel: Relation = { ...r, id: assign(r.id), from, to };
    delete rel.external;
    relations.push(rel);
    if (!fromIn || !toIn) report.reconnectedRelations.push(r);
  }

  const achievements = source.achievements.flatMap((a) => {
    const skillIds = a.skillIds.filter((s) => inside.has(s)).map((s) => report.idMap.get(s)!);
    return skillIds.length ? [{ ...a, id: assign(a.id), skillIds }] : [];
  });

  const sources = target.sources ?? [];
  return {
    doc: {
      ...target,
      sources: sources.some((s) => s.treeId === source.id)
        ? sources
        : [...sources, { treeId: source.id, title: source.title }],
      nodes: [...target.nodes, ...nodes],
      relations: [...target.relations, ...relations],
      achievements: [...target.achievements, ...achievements],
    },
    report,
  };
}
