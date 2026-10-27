import type { ELK, ElkNode } from "elkjs/lib/elk-api";
import type { LevelView, ViewNode } from "../viewgraph/viewgraph";

// 一つの階層を ELK で平面に配置する。座標は階層の中心を原点にそろえる。

export interface Point {
  x: number;
  y: number;
}

export interface LevelLayout {
  /** ノード中心の座標 */
  positions: Map<string, Point>;
  /** 前提関係の折れ線（始点・折れ点・終点）。関連リンクは配置に使わないので含まない */
  routes: Map<string, Point[]>;
  /** 中心原点で見た外接半径 */
  radius: number;
  width: number;
  height: number;
  elapsedMs: number;
}

export const NODE_SIZE = { orb: 56, labelLine: 22, charWidth: 15, minWidth: 96, maxWidth: 210 };

/** ラベル込みの占有サイズ。長いラベルは折り返す前提で幅を抑える。 */
export function nodeBox(n: Pick<ViewNode, "title">): { width: number; height: number } {
  const textWidth = [...n.title].length * NODE_SIZE.charWidth;
  const width = Math.min(NODE_SIZE.maxWidth, Math.max(NODE_SIZE.minWidth, textWidth));
  const lines = Math.ceil(textWidth / NODE_SIZE.maxWidth);
  return { width, height: NODE_SIZE.orb + 10 + lines * NODE_SIZE.labelLine };
}

export const LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "48",
  "elk.layered.spacing.nodeNodeBetweenLayers": "110",
  "elk.spacing.componentComponent": "70",
  "elk.edgeRouting": "SPLINES",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.randomSeed": "1",
  "elk.aspectRatio": "1.6",
};

export async function layoutLevel(elk: ELK, view: LevelView): Promise<LevelLayout> {
  const started = performance.now();
  const graph: ElkNode = {
    id: `level:${view.levelId ?? "root"}`,
    layoutOptions: LAYOUT_OPTIONS,
    children: view.nodes.map((n) => ({ id: n.id, ...nodeBox(n) })),
    // 前提関係だけで層を決める。関連リンクは方向を持たないので配置を縛らない
    edges: view.edges
      .filter((e) => e.type === "prerequisite")
      .map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };
  const out = await elk.layout(graph);
  const width = out.width ?? 0;
  const height = out.height ?? 0;
  const cx = width / 2;
  const cy = height / 2;
  const positions = new Map<string, Point>();
  let radius = 0;
  for (const c of out.children ?? []) {
    const p = { x: (c.x ?? 0) + (c.width ?? 0) / 2 - cx, y: (c.y ?? 0) + NODE_SIZE.orb / 2 - cy };
    positions.set(c.id, p);
    radius = Math.max(radius, Math.hypot(p.x, p.y) + (c.width ?? 0) / 2);
  }
  const routes = new Map<string, Point[]>();
  for (const e of out.edges ?? []) {
    const s = e.sections?.[0];
    if (!s) continue;
    routes.set(
      e.id,
      [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({
        x: p.x - cx,
        y: p.y - cy,
      })),
    );
  }
  return {
    positions,
    routes,
    radius: Math.max(radius, 120),
    width,
    height,
    elapsedMs: performance.now() - started,
  };
}
