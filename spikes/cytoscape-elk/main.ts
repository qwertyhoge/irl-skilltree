// Spike A: Cytoscape.js + ELK で、入れ子・階層越えリンク・視点移動・ダイブがどこまで成立するかを見る。
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import cyElk from "cytoscape-elk";
import ELK from "elkjs/lib/elk.bundled.js";
import sample from "../../samples/math.v1.json";
import type { TreeDoc } from "../../src/model/schema";
import { indexTree } from "../../src/model/tree";
import { buildLevelView } from "../../src/viewgraph/viewgraph";
import { layoutLevel } from "../../src/layout/elkLayout";

cytoscape.use(cyElk);
const ix = indexTree(sample as TreeDoc);
const elk = new ELK();
const metrics: Record<string, unknown> = {};
(window as unknown as { __spike: unknown }).__spike = metrics;
const $ = (id: string) => document.getElementById(id)!;
const log = (s: string) => ($("log").textContent = s);

const style: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      color: "#dfe6ff",
      "font-size": 13,
      "text-valign": "bottom",
      "text-margin-y": 6,
      "background-color": "#5b8cff",
      width: 40,
      height: 40,
      "text-wrap": "wrap",
      "text-max-width": "160px",
    },
  },
  { selector: "node.group", style: { "background-color": "#b07cff", shape: "round-hexagon" } },
  {
    selector: ":parent",
    style: {
      "background-opacity": 0.08,
      "border-color": "#3a4c80",
      "border-width": 1,
      "text-valign": "top",
      shape: "round-rectangle",
      padding: "24px",
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": "#6c7fb8",
      "target-arrow-color": "#6c7fb8",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      opacity: 0.8,
    },
  },
  {
    selector: "edge.related",
    style: { "line-style": "dashed", "target-arrow-shape": "none", "line-color": "#4f9d8c" },
  },
  {
    selector: "node:selected",
    style: { "background-color": "#ffd36b", "border-width": 3, "border-color": "#fff3c4" },
  },
];

let cy: Core = cytoscape({ container: $("cy"), style, wheelSensitivity: 0.3 });
const expose = () => ((window as unknown as { __cy: Core }).__cy = cy);

// --- モード1: 全体を compound nodes で一枚にする ---
async function showCompound() {
  const els: ElementDefinition[] = [
    ...ix.doc.nodes.map((n) => ({
      data: { id: n.id, label: n.title, parent: n.parentId ?? undefined },
      classes: n.kind,
    })),
    ...ix.doc.relations.map((r) => ({
      data: { id: r.id, source: r.from, target: r.to },
      classes: r.type,
    })),
  ];
  cy.destroy();
  cy = cytoscape({ container: $("cy"), style, elements: els });
  const t0 = performance.now();
  const layout = cy.layout({
    name: "elk",
    elk: {
      algorithm: "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
    },
  } as cytoscape.LayoutOptions);
  await new Promise<void>((done) => {
    layout.one("layoutstop", () => done());
    layout.run();
  });
  metrics.compoundLayoutMs = performance.now() - t0;

  // ELK を直接呼んだ結果と、Cytoscape に反映された位置の差を測る（親オフセットの扱いの確認）
  metrics.compoundOffset = await measureOffset();
  cy.on("tap", "node", (ev) => {
    const n = ev.target;
    cy.animate(
      { center: { eles: n }, zoom: Math.max(cy.zoom(), 1.4) },
      { duration: 500, easing: "ease-out-expo" },
    );
  });
  log(`compound layout ${(metrics.compoundLayoutMs as number).toFixed(0)}ms`);
}

async function measureOffset() {
  const toElk = (parent: string | null): import("elkjs/lib/elk-api").ElkNode[] =>
    (ix.children.get(parent) ?? []).map((id) => ({
      id,
      width: 40,
      height: 40,
      children: toElk(id),
    }));
  const t0 = performance.now();
  const res = await elk.layout({
    id: "root",
    layoutOptions: {
      algorithm: "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: toElk(null),
    edges: ix.doc.relations.map((r) => ({ id: r.id, sources: [r.from], targets: [r.to] })),
  });
  const directMs = performance.now() - t0;
  // ELK の子座標は親の左上からの相対。絶対座標に直して Cytoscape の position と比べる
  const abs = new Map<string, { x: number; y: number }>();
  const walk = (n: import("elkjs/lib/elk-api").ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0),
        y = oy + (c.y ?? 0);
      abs.set(c.id, { x: x + (c.width ?? 0) / 2, y: y + (c.height ?? 0) / 2 });
      walk(c, x, y);
    }
  };
  walk(res, 0, 0);
  const leaf = cy.nodes().filter((n) => n.isChildless()) as cytoscape.NodeCollection;
  const deltas = leaf.map((n) => {
    const a = abs.get(n.id())!,
      p = n.position();
    return { dx: p.x - a.x, dy: p.y - a.y };
  });
  const edgesWithBends = (
    (res.edges ?? []) as import("elkjs/lib/elk-api").ElkExtendedEdge[]
  ).filter((e) => (e.sections?.[0]?.bendPoints?.length ?? 0) > 0).length;
  // 階層越えの辺は、ELK では共通祖先の座標系で返る
  const containers = new Set((res.edges ?? []).map((e) => (e as { container?: string }).container));
  return { directMs, sample: deltas.slice(0, 3), edgesWithBends, edgeContainers: [...containers] };
}

// --- モード2: 階層ごとに描き、ダイブで切り替える ---
type Frame = {
  levelId: string | null;
  pan: cytoscape.Position;
  zoom: number;
  selected: string | null;
};
const stack: Frame[] = [];
let levelId: string | null = null;

async function showLevel(id: string | null, from?: { x: number; y: number }) {
  levelId = id;
  const view = buildLevelView(ix, id);
  const lay = await layoutLevel(elk, view);
  metrics.levelLayoutMs = lay.elapsedMs;
  cy.elements().remove();
  cy.add([
    ...view.nodes.map((n) => ({
      data: { id: n.id, label: n.title },
      classes: n.kind,
      position: from ? { ...from } : lay.positions.get(n.id)!,
    })),
    ...view.edges.map((e) => ({
      data: { id: e.id, source: e.from, target: e.to },
      classes: e.type,
    })),
  ]);
  $("crumb").textContent = [
    "人生",
    ...(id ? [...ancestorTitles(id), ix.byId.get(id)!.title] : []),
  ].join(" › ");
  if (from) {
    // 子グラフが親ノードの位置から広がって出てくる
    cy.nodes().style("opacity", 0);
    cy.nodes().forEach((n, i) => {
      n.animate(
        { position: lay.positions.get(n.id())!, style: { opacity: 1 } },
        { duration: 600, easing: "ease-out-expo", queue: false },
      );
      void i;
    });
  }
  return lay;
}

/** レイアウト後の位置（アニメーション前）に合わせた視点 */
function viewportFor(lay: {
  width: number;
  height: number;
  positions: Map<string, { x: number; y: number }>;
}) {
  const xs = [...lay.positions.values()];
  const minX = Math.min(...xs.map((p) => p.x)) - 100,
    maxX = Math.max(...xs.map((p) => p.x)) + 100;
  const minY = Math.min(...xs.map((p) => p.y)) - 80,
    maxY = Math.max(...xs.map((p) => p.y)) + 120;
  const zoom = Math.min(1.6, cy.width() / (maxX - minX), cy.height() / (maxY - minY));
  return {
    zoom,
    pan: {
      x: cy.width() / 2 - ((minX + maxX) / 2) * zoom,
      y: cy.height() / 2 - ((minY + maxY) / 2) * zoom,
    },
  };
}
const ancestorTitles = (id: string) => {
  const out: string[] = [];
  let cur = ix.byId.get(id)?.parentId ?? null;
  while (cur) {
    out.unshift(ix.byId.get(cur)!.title);
    cur = ix.byId.get(cur)!.parentId;
  }
  return out;
};

async function startLevelMode() {
  cy.destroy();
  cy = cytoscape({ container: $("cy"), style, wheelSensitivity: 0.3 });
  stack.length = 0;
  expose();
  cy.viewport(viewportFor(await showLevel(null)));
  cy.on("tap", "node", (ev) => {
    const n = ev.target;
    cy.stop();
    cy.animate(
      { center: { eles: n }, zoom: Math.max(cy.zoom(), 1.2) },
      { duration: 500, easing: "ease-out-expo" },
    );
  });
  cy.on("dbltap", "node.group", async (ev) => {
    const n = ev.target;
    const pos = { ...n.position() };
    stack.push({ levelId, pan: { ...cy.pan() }, zoom: cy.zoom(), selected: n.id() });
    // 接近: 対象ノードを中心に大きく拡大し、他を消す
    cy.elements()
      .not(n)
      .animate({ style: { opacity: 0 } }, { duration: 400 });
    await cy
      .animation({
        zoom: { level: cy.zoom() * 6, position: pos },
        duration: 450,
        easing: "ease-in-cubic",
      })
      .play()
      .promise();
    // 差し替え: 子グラフを親の位置から展開し、全体が見える倍率へ戻す
    const lay = await showLevel(n.id(), pos);
    const target = viewportFor(lay);
    cy.viewport({
      zoom: target.zoom * 3,
      pan: {
        x: cy.width() / 2 - pos.x * target.zoom * 3,
        y: cy.height() / 2 - pos.y * target.zoom * 3,
      },
    });
    cy.animate(target, { duration: 650, easing: "ease-out-expo" });
  });
}

async function back() {
  const f = stack.pop();
  if (!f) return;
  await showLevel(f.levelId);
  cy.viewport({ zoom: f.zoom * 4, pan: f.pan });
  cy.animate({ zoom: f.zoom, pan: f.pan }, { duration: 600, easing: "ease-out-expo" });
  if (f.selected) cy.$id(f.selected).select();
}

$("compound").onclick = () => void showCompound();
$("level").onclick = () => void startLevelMode();
$("back").onclick = () => void back();
void startLevelMode();
