// Spike B: ELK の平面配置を Three.js に渡し、透視カメラで「ノードの中に次の世界がある」ダイブを試す。
// 子階層は親ノードの球の内側に縮尺 k で置く。出現・消失の度合いは時間ではなくカメラ距離から決める。
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import ELK from "elkjs/lib/elk.bundled.js";
import sample from "../../samples/math.v1.json";
import type { TreeDoc } from "../../src/model/schema";
import { indexTree } from "../../src/model/tree";
import { buildLevelView } from "../../src/viewgraph/viewgraph";
import { layoutLevel, NODE_SIZE, type LevelLayout } from "../../src/layout/elkLayout";

const ix = indexTree(sample as TreeDoc);
const elk = new ELK();
const metrics: Record<string, number | string> = {};
(window as unknown as { __spike: unknown }).__spike = metrics;
const $ = (id: string) => document.getElementById(id)!;

const stage = $("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
stage.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.id = "labels";
stage.appendChild(labels.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070b18, 0.00035);
const camera = new THREE.PerspectiveCamera(40, 1, 1, 100000);
const FOV = THREE.MathUtils.degToRad(40);
const TILT = THREE.MathUtils.degToRad(12);
const ORB = NODE_SIZE.orb / 2;

// --- 星空（奥行きの手がかり） ---
{
  const g = new THREE.BufferGeometry();
  const pts = new Float32Array(1500 * 3);
  for (let i = 0; i < pts.length; i++)
    pts[i] = (Math.random() - 0.5) * (i % 3 === 2 ? 3000 : 6000) - (i % 3 === 2 ? 1500 : 0);
  g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  scene.add(
    new THREE.Points(
      g,
      new THREE.PointsMaterial({
        color: 0x8090c0,
        size: 2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.5,
      }),
    ),
  );
}

const glowTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

interface NodeVis {
  id: string;
  group: THREE.Group;
  orb: THREE.Mesh;
  glow: THREE.Sprite;
  label: CSS2DObject;
  base: THREE.Vector3;
  phase: number;
  isGroup: boolean;
}
interface Frame {
  levelId: string | null;
  root: THREE.Group;
  nodes: Map<string, NodeVis>;
  lines: Line2[];
  layout: LevelLayout;
  opacity: number;
  spread: number;
}

const lineMats: LineMaterial[] = [];

async function buildFrame(levelId: string | null): Promise<Frame> {
  const view = buildLevelView(ix, levelId);
  const layout = await layoutLevel(elk, view);
  metrics[`layoutMs:${levelId ?? "root"}`] = Math.round(layout.elapsedMs);
  const root = new THREE.Group();
  const nodes = new Map<string, NodeVis>();
  for (const n of view.nodes) {
    const p = layout.positions.get(n.id)!;
    const isGroup = n.kind === "group";
    const color = new THREE.Color(isGroup ? 0xb07cff : 0x5b8cff);
    const group = new THREE.Group();
    // 奥行きは構造から決める: 名前のハッシュで小さく前後させるだけ（座標入力なし）
    const phase = [...n.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    const base = new THREE.Vector3(p.x, -p.y, ((phase % 7) - 3) * 14);
    group.position.copy(base);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(isGroup ? ORB : ORB * 0.72, 32, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true }),
    );
    orb.userData.id = n.id;
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    glow.scale.setScalar(ORB * 4.2);
    const el = document.createElement("div");
    el.className = "lbl";
    el.innerHTML = "<div></div>";
    (el.firstChild as HTMLElement).textContent = n.title;
    const label = new CSS2DObject(el);
    label.center.set(0.5, 0);
    group.add(glow, orb, label);
    root.add(group);
    nodes.set(n.id, { id: n.id, group, orb, glow, label, base, phase, isGroup });
  }
  const lines: Line2[] = [];
  for (const e of view.edges) {
    const a = nodes.get(e.from)!.base,
      b = nodes.get(e.to)!.base;
    const route = layout.routes.get(e.id);
    const pts: THREE.Vector3[] = [];
    if (route && route.length >= 2) {
      // ELK の経路を使う。端点はノード中心へ寄せる（ELK の端点は箱の縁）
      const curve = new THREE.CatmullRomCurve3([
        a,
        ...route.slice(1, -1).map((q) => new THREE.Vector3(q.x, -q.y, (a.z + b.z) / 2)),
        b,
      ]);
      pts.push(...curve.getPoints(24));
    } else {
      const mid = a
        .clone()
        .add(b)
        .multiplyScalar(0.5)
        .add(new THREE.Vector3(0, 0, 40));
      pts.push(...new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(24));
    }
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((v) => [v.x, v.y, v.z]));
    const mat = new LineMaterial({
      color: e.type === "prerequisite" ? 0x8aa0e0 : 0x4fb39c,
      linewidth: e.type === "prerequisite" ? 2 : 1.5,
      transparent: true,
      dashed: e.type === "related",
      dashSize: 10,
      gapSize: 8,
    });
    lineMats.push(mat);
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    root.add(line);
    lines.push(line);
  }
  scene.add(root);
  return { levelId, root, nodes, lines, layout, opacity: 1, spread: 1 };
}

/** 階層全体が収まるカメラ距離（フレームの縮尺 1 のとき） */
const fitDistance = (f: Frame) =>
  Math.max(
    500,
    (Math.max(f.layout.width / camera.aspect, f.layout.height) / 2 + 140) / Math.tan(FOV / 2),
  );

// --- カメラ: 注視点と距離。距離は対数空間で補間する ---
const cam = { target: new THREE.Vector3(), dist: 1000 };
type Tween = {
  from: { t: THREE.Vector3; ld: number };
  to: { t: THREE.Vector3; ld: number };
  start: number;
  dur: number;
  ease: (u: number) => number;
  done?: () => void;
};
let tween: Tween | null = null;
const easeOutExpo = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
const easeOutQuart = (u: number) => 1 - Math.pow(1 - u, 4);
const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const EASE = { expo: easeOutExpo, quart: easeOutQuart, inout: easeInOutCubic };
const params = new URLSearchParams(location.search);
const diveEase = EASE[(params.get("dive") ?? "quart") as keyof typeof EASE];
function flyTo(
  target: THREE.Vector3,
  dist: number,
  dur: number,
  done?: () => void,
  ease = easeOutExpo,
) {
  // 途中で呼ばれても、現在値から目標を差し替える
  tween = {
    from: { t: cam.target.clone(), ld: Math.log(cam.dist) },
    to: { t: target.clone(), ld: Math.log(dist) },
    start: performance.now(),
    dur,
    ease,
    done,
  };
}

// --- 階層のスタック。current は常に縮尺 1・原点に置き直す ---
let current: Frame;
let inner: Frame | null = null; // 入っている途中の子
let outer: Frame | null = null; // 戻っている途中の親
let selected: string | null = null;
let transition: { kind: "enter" | "exit"; node: string; k: number; d0: number; d1: number } | null =
  null;
const history: {
  levelId: string | null;
  selected: string | null;
  target: THREE.Vector3;
  dist: number;
}[] = [];

function placeChild(child: Frame, parent: Frame, nodeId: string) {
  const host = parent.nodes.get(nodeId)!;
  const k = (ORB * 0.85) / child.layout.radius;
  child.root.position.copy(host.base).multiplyScalar(parent.root.scale.x).add(parent.root.position);
  child.root.scale.setScalar(k * parent.root.scale.x);
  return k;
}

/** 子フレームを新しい基準にし、見た目を変えずに全体を座標変換する */
function rebase(next: Frame) {
  const s = next.root.scale.x,
    o = next.root.position.clone();
  for (const f of new Set([current, inner, outer, next])) {
    if (!f) continue;
    f.root.position.sub(o).divideScalar(s);
    f.root.scale.divideScalar(s);
  }
  cam.target.sub(o).divideScalar(s);
  cam.dist /= s;
  if (tween) {
    tween.from.t.sub(o).divideScalar(s);
    tween.to.t.sub(o).divideScalar(s);
    tween.from.ld -= Math.log(s);
    tween.to.ld -= Math.log(s);
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

async function enter(nodeId: string) {
  const node = ix.byId.get(nodeId);
  if (!node || node.kind !== "group" || transition) return;
  history.push({
    levelId: current.levelId,
    selected: nodeId,
    target: cam.target.clone(),
    dist: cam.dist,
  });
  inner = await buildFrame(nodeId);
  const k = placeChild(inner, current, nodeId);
  const d1 = fitDistance(inner) * k;
  transition = { kind: "enter", node: nodeId, k, d0: cam.dist, d1 };
  const t0 = performance.now();
  flyTo(
    inner.root.position,
    d1,
    900,
    () => {
      metrics.enterMs = Math.round(performance.now() - t0);
      const f = inner!;
      scene.remove(current.root);
      rebase(f);
      current = f;
      inner = null;
      transition = null;
      selected = null;
      updateCrumb();
    },
    diveEase,
  );
}

async function back() {
  const h = history.pop();
  if (!h || transition) return;
  const fromId = current.levelId!;
  outer = await buildFrame(h.levelId);
  // 親フレームを、今の階層が親ノードの球の中に収まる位置へ置く
  const host = outer.nodes.get(fromId)!;
  const k = (ORB * 0.85) / current.layout.radius;
  outer.root.scale.setScalar(1 / k);
  outer.root.position.copy(host.base).multiplyScalar(-1 / k);
  transition = { kind: "exit", node: fromId, k, d0: cam.dist, d1: h.dist / k };
  flyTo(
    h.target
      .clone()
      .multiplyScalar(1 / k)
      .add(outer.root.position),
    h.dist / k,
    800,
    () => {
      const f = outer!;
      scene.remove(current.root);
      rebase(f);
      current = f;
      outer = null;
      transition = null;
      selected = h.selected;
      updateCrumb();
    },
    diveEase,
  );
}

function select(id: string) {
  selected = id;
  const v = current.nodes.get(id)!;
  flyTo(v.base.clone(), Math.min(cam.dist, fitDistance(current) * 0.8), 550);
}

function updateCrumb() {
  const id = current.levelId;
  const names = id
    ? [...history.slice(1).map((h) => ix.byId.get(h.levelId!)!.title), ix.byId.get(id)!.title]
    : [];
  $("crumb").textContent = ["人生", ...names].join(" › ");
}

// --- 毎フレーム ---
const ref = { ppu: 0 };
function frameLoop(now: number) {
  if (tween) {
    const u = Math.min(1, (now - tween.start) / tween.dur);
    const e = tween.ease(u);
    cam.target.lerpVectors(tween.from.t, tween.to.t, e);
    cam.dist = Math.exp(THREE.MathUtils.lerp(tween.from.ld, tween.to.ld, e));
    if (u >= 1) {
      const done = tween.done;
      tween = null;
      done?.();
    }
  }
  // 出入りの進み具合はカメラ距離から求める（中断・逆再生しても見た目が破綻しない）
  if (transition) {
    const p = THREE.MathUtils.clamp(
      Math.log(transition.d0 / cam.dist) / Math.log(transition.d0 / transition.d1),
      0,
      1,
    );
    const enterP = transition.kind === "enter" ? p : 1 - p; // 0 = 外にいる, 1 = 中にいる
    const outerF = transition.kind === "enter" ? current : outer!;
    const innerF = transition.kind === "enter" ? inner! : current;
    outerF.opacity = 1 - smooth(0.55, 0.92, enterP);
    innerF.opacity = smooth(0.35, 0.85, enterP);
    innerF.spread = 0.55 + 0.45 * smooth(0.3, 1, enterP);
    const host = outerF.nodes.get(transition.node)!;
    host.orb.visible = enterP < 0.7;
  } else {
    current.opacity = 1;
    current.spread = 1;
  }

  camera.near = cam.dist * 0.02;
  camera.far = cam.dist * 60;
  camera.position.set(
    cam.target.x,
    cam.target.y - Math.sin(TILT) * cam.dist,
    cam.target.z + Math.cos(TILT) * cam.dist,
  );
  camera.lookAt(cam.target);
  camera.updateProjectionMatrix();
  // ラベルの拡大率: 縮尺 1 のフレームを距離 1000 で見たときを 1 とする
  const ppu = (h: number, d: number) => h / 2 / (Math.tan(FOV / 2) * d);
  ref.ppu = ppu(renderer.domElement.clientHeight, 1000);

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const f of [outer, current, inner]) {
    if (!f) continue;
    f.root.visible = f.opacity > 0.01;
    for (const v of f.nodes.values()) {
      const float = reduce ? 0 : Math.sin(now / 1400 + v.phase) * 4;
      v.group.position.set(v.base.x * f.spread, v.base.y * f.spread + float, v.base.z);
      const breathe = reduce ? 1 : 1 + Math.sin(now / 900 + v.phase * 1.7) * 0.12;
      const sel = v.id === selected;
      v.glow.scale.setScalar(ORB * (sel ? 6 : 4.2) * breathe);
      (v.glow.material as THREE.SpriteMaterial).opacity = f.opacity * (sel ? 0.9 : 0.55);
      (v.orb.material as THREE.MeshBasicMaterial).opacity = f.opacity;
      const world = v.group.getWorldPosition(new THREE.Vector3());
      const scale =
        (f.root.scale.x *
          ppu(renderer.domElement.clientHeight, camera.position.distanceTo(world))) /
        ref.ppu;
      const inner = v.label.element.firstChild as HTMLElement;
      const ls = Math.min(1.5, scale);
      v.label.element.style.opacity = String(f.opacity * smooth(0.3, 0.6, scale));
      inner.style.transform = `scale(${ls})`;
      inner.style.paddingTop = `${34}px`;
      inner.style.color = sel ? "#ffe9a8" : "";
    }
    for (const l of f.lines) {
      const m = l.material as LineMaterial;
      m.opacity = f.opacity * 0.75;
      l.scale.setScalar(f.spread);
    }
  }
  renderer.render(scene, camera);
  labels.render(scene, camera);
  requestAnimationFrame(frameLoop);
}

function resize() {
  const w = stage.clientWidth,
    h = stage.clientHeight;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  for (const m of lineMats) m.resolution.set(w, h);
}
addEventListener("resize", resize);

// --- 入力 ---
const ray = new THREE.Raycaster();
function pick(ev: MouseEvent): string | null {
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(
    new THREE.Vector2(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1,
    ),
    camera,
  );
  const hit = ray.intersectObjects([...current.nodes.values()].map((v) => v.orb))[0];
  return hit ? (hit.object.userData.id as string) : null;
}
renderer.domElement.addEventListener("click", (ev) => {
  const id = pick(ev);
  if (id) select(id);
});
renderer.domElement.addEventListener("dblclick", (ev) => {
  const id = pick(ev);
  if (id) void enter(id);
});
$("enter").onclick = () => selected && void enter(selected);
$("back").onclick = () => void back();

// 検証用: 画面座標を返す
(window as unknown as { __screenOf: (id: string) => { x: number; y: number } | null }).__screenOf =
  (id) => {
    const v = current.nodes.get(id);
    if (!v) return null;
    const p = v.group.getWorldPosition(new THREE.Vector3()).project(camera);
    return { x: ((p.x + 1) / 2) * stage.clientWidth, y: ((1 - p.y) / 2) * stage.clientHeight };
  };

(async () => {
  resize();
  current = await buildFrame(null);
  cam.dist = fitDistance(current);
  updateCrumb();
  let frames = 0;
  const t0 = performance.now();
  const count = () => {
    frames++;
    if (performance.now() - t0 < 2000) requestAnimationFrame(count);
    else metrics.fpsIdle = Math.round(frames / 2);
  };
  requestAnimationFrame(count);
  requestAnimationFrame(frameLoop);
})();
