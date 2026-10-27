import type { Relation, RelationType, SkillNode } from "../model/schema";
import { ancestorsOf, childrenOf, type TreeIndex } from "../model/tree";

// 現在の階層（ある分野の直下）に見せるものを、意味モデルから生成する。

export interface ViewNode {
  id: string;
  title: string;
  kind: SkillNode["kind"];
  childCount: number;
  /** この階層の外とつながっている関係の数（ポータル化されていないものも含む） */
  externalCount: number;
}

/** 階層内の二ノード間の線。内部の子孫同士の関係も持ち上げて集約する。 */
export interface ViewEdge {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  relations: Relation[];
  /** 両端が階層の直下ノードそのもので、持ち上げなしの関係を含むか */
  direct: boolean;
}

/** 階層の外にある相手への接続。anchor は階層内の持ち上げ先。 */
export interface Portal {
  id: string;
  anchorId: string;
  targetId: string;
  targetTitle: string;
  /** 相手の所属（ルートから親まで） */
  targetPath: string[];
  type: RelationType;
  /** anchor 側から見た向き。out: anchor が相手の前提・関連元 */
  direction: "in" | "out";
  relations: Relation[];
}

export interface LevelView {
  levelId: string | null;
  nodes: ViewNode[];
  edges: ViewEdge[];
  /** 選択中ノードに関係する外部接続だけ。全件は nodes[].externalCount と relationsAround で引ける */
  portals: Portal[];
}

/** endpoint を levelId 直下の祖先に持ち上げる。階層の外なら null。 */
export function liftTo(ix: TreeIndex, levelId: string | null, endpoint: string): string | null {
  if (!ix.byId.has(endpoint)) return null;
  const chain = [...ancestorsOf(ix, endpoint), ix.byId.get(endpoint)!];
  if (levelId === null) return chain[0].id;
  const at = chain.findIndex((n) => n.id === levelId);
  return at >= 0 && at + 1 < chain.length ? chain[at + 1].id : null;
}

export function buildLevelView(
  ix: TreeIndex,
  levelId: string | null,
  selectedId: string | null = null,
): LevelView {
  const members = childrenOf(ix, levelId);
  const externalCount = new Map<string, number>();
  const edges = new Map<string, ViewEdge>();
  const portals = new Map<string, Portal>();

  for (const r of ix.doc.relations) {
    const a = liftTo(ix, levelId, r.from);
    const b = liftTo(ix, levelId, r.to);
    if (a !== null && b !== null) {
      if (a === b) continue; // 一つのノードの内部で閉じている
      const key = `${a}|${b}|${r.type}`;
      const e = edges.get(key) ?? {
        id: key,
        from: a,
        to: b,
        type: r.type,
        relations: [],
        direct: false,
      };
      e.relations.push(r);
      e.direct ||= a === r.from && b === r.to;
      edges.set(key, e);
      continue;
    }
    const anchor = a ?? b;
    if (anchor === null) continue; // 両端とも階層の外
    externalCount.set(anchor, (externalCount.get(anchor) ?? 0) + 1);
    if (anchor !== selectedId) continue;

    const direction = a !== null ? "out" : "in";
    const targetId = direction === "out" ? r.to : r.from;
    const target = ix.byId.get(targetId);
    const key = `${anchor}|${targetId}|${r.type}|${direction}`;
    const p = portals.get(key) ?? {
      id: key,
      anchorId: anchor,
      targetId,
      targetTitle: target?.title ?? r.external?.title ?? targetId,
      targetPath: target ? ancestorsOf(ix, targetId).map((n) => n.title) : (r.external?.path ?? []),
      type: r.type,
      direction,
      relations: [],
    };
    p.relations.push(r);
    portals.set(key, p);
  }

  return {
    levelId,
    nodes: members.map((n) => ({
      id: n.id,
      title: n.title,
      kind: n.kind,
      childCount: ix.children.get(n.id)?.length ?? 0,
      externalCount: externalCount.get(n.id) ?? 0,
    })),
    edges: [...edges.values()],
    portals: [...portals.values()],
  };
}

export interface RelationAround {
  relation: Relation;
  direction: "in" | "out";
  other: SkillNode | undefined;
  otherId: string;
  /** 相手の所属（ルートから親まで） */
  otherPath: string[];
  /** 相手がこのノードの内部にあるか */
  inner: boolean;
}

/** ノードとその内部に関わる関係の一覧。説明パネルの「つながり」に使う。 */
export function relationsAround(ix: TreeIndex, nodeId: string): RelationAround[] {
  const out: RelationAround[] = [];
  for (const r of ix.doc.relations) {
    const fromIn = r.from === nodeId || ancestorsOf(ix, r.from).some((n) => n.id === nodeId);
    const toIn = r.to === nodeId || ancestorsOf(ix, r.to).some((n) => n.id === nodeId);
    if (!fromIn && !toIn) continue;
    if (fromIn && toIn && r.from !== nodeId && r.to !== nodeId) continue; // 内部同士
    const direction = fromIn ? "out" : "in";
    const otherId = direction === "out" ? r.to : r.from;
    const other = ix.byId.get(otherId);
    out.push({
      relation: r,
      direction,
      other,
      otherId,
      otherPath: other ? ancestorsOf(ix, otherId).map((n) => n.title) : (r.external?.path ?? []),
      inner: direction === "out" ? toIn : fromIn,
    });
  }
  return out;
}
