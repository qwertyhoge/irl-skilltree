import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { LevelLayout, Point } from "../layout/elkLayout";
import { NODE_SIZE } from "../layout/elkLayout";
import type { LevelView, Portal, ViewEdge } from "../viewgraph/viewgraph";
import { tuning } from "../tuning";

// 一つの階層の見た目。座標はフレームのローカル（ELK の配置、y は上向きに反転）。

export const ORB = NODE_SIZE.orb / 2;

export const BRANCH_COLORS = [0x8f7bff, 0x3fc1c9, 0xffb454, 0xff6f91, 0x7bd389, 0x5ea8ff];

export interface NodeVis {
  id: string;
  kind: "group" | "skill";
  base: THREE.Vector3;
  phase: number;
  /** 出現の順番（中心に近いものから 0〜1） */
  order: number;
  group: THREE.Group;
  orb: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null;
  glow: THREE.Sprite;
  hit: THREE.Mesh;
  label: CSS2DObject;
  labelInner: HTMLElement;
  emphasis: number;
}

export interface EdgeVis {
  edge: ViewEdge;
  line: Line2;
  material: LineMaterial;
  arrow: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial> | null;
  baseWidth: number;
  emphasis: number;
}

export interface PortalVis {
  portal: Portal;
  group: THREE.Group;
  gem: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>;
  hit: THREE.Mesh;
  line: Line2;
  material: LineMaterial;
  label: CSS2DObject;
  labelInner: HTMLElement;
  born: number;
}

const glowTexture = (() => {
  let tex: THREE.Texture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.22, "rgba(255,255,255,0.5)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.12)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

const hitGeometry = new THREE.SphereGeometry(ORB * 1.25, 8, 6);
const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

function hashPhase(id: string): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

function makeLabel(
  title: string,
  sub: string | null,
  cls: string,
): { obj: CSS2DObject; inner: HTMLElement } {
  const outer = document.createElement("div");
  outer.className = `node-label ${cls}`;
  const inner = document.createElement("div");
  inner.className = "node-label-inner";
  const t = document.createElement("div");
  t.className = "node-label-title";
  t.textContent = title;
  inner.appendChild(t);
  if (sub) {
    const s = document.createElement("div");
    s.className = "node-label-sub";
    s.textContent = sub;
    inner.appendChild(s);
  }
  outer.appendChild(inner);
  const obj = new CSS2DObject(outer);
  obj.center.set(0.5, 0);
  return { obj, inner };
}

/** ELK の SPLINES 出力は三次ベジェの制御点列。端点はノード中心に付け替える */
function edgeCurve(
  a: THREE.Vector3,
  b: THREE.Vector3,
  route: Point[] | undefined,
): THREE.Curve<THREE.Vector3> {
  const z = (a.z + b.z) / 2;
  const v = (p: Point) => new THREE.Vector3(p.x, -p.y, z);
  if (route && route.length >= 4 && (route.length - 1) % 3 === 0) {
    const path = new THREE.CurvePath<THREE.Vector3>();
    const pts = route.map(v);
    pts[0] = a.clone();
    pts[pts.length - 1] = b.clone();
    for (let i = 0; i + 3 < pts.length; i += 3) {
      path.add(new THREE.CubicBezierCurve3(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]));
    }
    return path;
  }
  // 経路がなければ、配置の向き（左→右）に沿った緩い S 字
  const dx = Math.max(60, Math.abs(b.x - a.x) * 0.45);
  const sign = b.x >= a.x ? 1 : -1;
  return new THREE.CubicBezierCurve3(
    a,
    new THREE.Vector3(a.x + dx * sign, a.y, a.z + 20),
    new THREE.Vector3(b.x - dx * sign, b.y, b.z + 20),
    b,
  );
}

export class LevelFrame {
  readonly root = new THREE.Group();
  /** 線と矢印。出現中は中心から広がるので、まとめて拡大縮小する */
  readonly edgeLayer = new THREE.Group();
  readonly nodes = new Map<string, NodeVis>();
  readonly edges: EdgeVis[] = [];
  portals: PortalVis[] = [];
  opacity = 1;
  /** 0〜1。子として現れる途中の度合い（1 で完全に現れている） */
  appear = 1;
  private materials: LineMaterial[] = [];

  constructor(
    readonly levelId: string | null,
    readonly view: LevelView,
    readonly layout: LevelLayout,
    private readonly colorOf: (id: string) => number,
  ) {
    this.root.add(this.edgeLayer);
    const maxDist = Math.max(
      1,
      ...view.nodes.map((n) =>
        Math.hypot(layout.positions.get(n.id)!.x, layout.positions.get(n.id)!.y),
      ),
    );
    for (const n of view.nodes) {
      const p = layout.positions.get(n.id)!;
      const phase = hashPhase(n.id);
      const base = new THREE.Vector3(p.x, -p.y, (phase - 0.5) * 2 * tuning.depthJitter);
      const color = new THREE.Color(colorOf(n.id));
      const isGroup = n.kind === "group";
      const group = new THREE.Group();
      group.position.copy(base);

      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(isGroup ? ORB : ORB * 0.66, 32, 16),
        new THREE.MeshBasicMaterial({
          color: isGroup ? color.clone().multiplyScalar(0.55) : color,
          transparent: true,
        }),
      );
      let ring: NodeVis["ring"] = null;
      if (isGroup) {
        // 中に世界がある分野は、明るい輪で囲む
        ring = new THREE.Mesh(
          new THREE.TorusGeometry(ORB * 1.08, 1.6, 8, 64),
          new THREE.MeshBasicMaterial({
            color: color.clone().lerp(new THREE.Color(0xffffff), 0.35),
            transparent: true,
          }),
        );
        ring.rotation.x = Math.PI / 2.6;
        group.add(ring);
      }
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        }),
      );
      glow.scale.setScalar(ORB * 4);
      const hit = new THREE.Mesh(hitGeometry, hitMaterial);
      hit.userData = { nodeId: n.id };

      const subParts: string[] = [];
      if (isGroup) subParts.push(n.childCount ? `${n.childCount} 項目` : "空");
      if (n.externalCount) subParts.push(`外部 ${n.externalCount}`);
      const { obj: label, inner: labelInner } = makeLabel(
        n.title,
        subParts.join(" · ") || null,
        isGroup ? "is-group" : "is-skill",
      );
      label.position.set(0, -ORB * (isGroup ? 1.25 : 0.85), 0);

      group.add(glow, orb, hit, label);
      this.root.add(group);
      this.nodes.set(n.id, {
        id: n.id,
        kind: n.kind,
        base,
        phase,
        order: Math.hypot(p.x, p.y) / maxDist,
        group,
        orb,
        ring,
        glow,
        hit,
        label,
        labelInner,
        emphasis: 0,
      });
    }

    for (const e of view.edges) {
      const a = this.nodes.get(e.from)!.base;
      const b = this.nodes.get(e.to)!.base;
      const curve = edgeCurve(a, b, layout.routes.get(e.id));
      const pts = curve.getPoints(32);
      const geo = new LineGeometry();
      geo.setPositions(pts.flatMap((v) => [v.x, v.y, v.z]));
      const isPre = e.type === "prerequisite";
      const baseWidth = (isPre ? 2 : 1.4) * Math.min(1.8, 1 + (e.relations.length - 1) * 0.25);
      const material = new LineMaterial({
        color: isPre ? 0x9fb2ff : 0x56c7ad,
        linewidth: baseWidth,
        transparent: true,
        depthWrite: false,
        dashed: !isPre,
        dashSize: 9,
        gapSize: 7,
      });
      this.materials.push(material);
      const line = new Line2(geo, material);
      line.computeLineDistances();
      line.renderOrder = -1;
      let arrow: EdgeVis["arrow"] = null;
      if (isPre) {
        // 終点の球の手前に向きを示す小さな円錐
        const t = curve.getUtoTmapping(0, Math.max(0, curve.getLength() - ORB * 1.15));
        const at = curve.getPoint(t);
        const dir = curve.getTangent(t).normalize();
        arrow = new THREE.Mesh(
          new THREE.ConeGeometry(4.5, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0xc4d0ff, transparent: true, depthWrite: false }),
        );
        arrow.position.copy(at);
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      }
      this.edgeLayer.add(line);
      if (arrow) this.edgeLayer.add(arrow);
      this.edges.push({ edge: e, line, material, arrow, baseWidth, emphasis: 0 });
    }
  }

  /** 選択ノードの外部接続を、その周りに扇状に置く。右が「先へ」、左が「手前から」 */
  setPortals(portals: Portal[], now: number) {
    for (const old of this.portals) this.disposePortal(old);
    const next: PortalVis[] = [];
    // 他のノードや置いたポータルから最も離れた候補を順に選ぶ
    const occupied = [...this.nodes.values()].map((n) => n.base.clone());
    for (const p of [...portals].sort((a, b) =>
      a.direction === b.direction ? 0 : a.direction === "out" ? -1 : 1,
    )) {
      const anchor = this.nodes.get(p.anchorId);
      if (!anchor) continue;
      let best: THREE.Vector3 | null = null;
      let bestScore = -Infinity;
      for (const r of [170, 240, 310]) {
        for (const d of [0, 24, -24, 48, -48, 72, -72]) {
          const rad = THREE.MathUtils.degToRad(d + (p.direction === "out" ? 0 : 180));
          const offset = new THREE.Vector3(Math.cos(rad) * r, Math.sin(rad) * r * 0.85, 30);
          const at = anchor.base.clone().add(offset);
          const clearance = Math.min(...occupied.map((o) => Math.hypot(o.x - at.x, o.y - at.y)));
          const score = Math.min(clearance, 150) - r * 0.12 - Math.abs(d) * 0.4;
          if (score > bestScore) {
            bestScore = score;
            best = offset;
          }
        }
      }
      const offset = best!;
      occupied.push(anchor.base.clone().add(offset));
      next.push(this.makePortal(p, anchor.base, offset, now));
    }
    this.portals = next;
  }

  private makePortal(
    p: Portal,
    anchor: THREE.Vector3,
    offset: THREE.Vector3,
    now: number,
  ): PortalVis {
    const group = new THREE.Group();
    group.position.copy(anchor).add(offset);
    const color = new THREE.Color(this.colorOf(p.targetId));
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(9),
      new THREE.MeshBasicMaterial({ color, transparent: true, wireframe: true }),
    );
    const hit = new THREE.Mesh(hitGeometry, hitMaterial);
    hit.scale.setScalar(0.55);
    hit.userData = { portalTarget: p.targetId };
    const geo = new LineGeometry();
    // 線はポータル側のローカル座標で、アンカーへ向かって引く
    const back = offset.clone().negate();
    geo.setPositions([back.x, back.y, back.z, back.x * 0.3, back.y * 0.3, 0, 0, 0, 0]);
    const material = new LineMaterial({
      color: p.type === "prerequisite" ? 0x9fb2ff : 0x56c7ad,
      linewidth: 1.2,
      transparent: true,
      depthWrite: false,
      dashed: true,
      dashSize: 4,
      gapSize: 5,
    });
    this.materials.push(material);
    const line = new Line2(geo, material);
    line.computeLineDistances();
    const arrowText =
      p.direction === "out"
        ? p.type === "prerequisite"
          ? "→ 次へ"
          : "↔ 関連"
        : p.type === "prerequisite"
          ? "← 前提"
          : "↔ 関連";
    const { obj: label, inner: labelInner } = makeLabel(
      p.targetTitle,
      `${arrowText} · ${p.targetPath.join(" › ") || "最上位"}`,
      "is-portal",
    );
    label.position.set(0, -14, 0);
    group.add(line, gem, hit, label);
    this.root.add(group);
    return { portal: p, group, gem, hit, line, material, label, labelInner, born: now };
  }

  private disposePortal(p: PortalVis) {
    this.root.remove(p.group);
    p.label.element.remove();
    p.gem.geometry.dispose();
    p.gem.material.dispose();
    p.line.geometry.dispose();
    p.material.dispose();
    this.materials = this.materials.filter((m) => m !== p.material);
  }

  setResolution(w: number, h: number) {
    for (const m of this.materials) m.resolution.set(w, h);
  }

  hitTargets(): THREE.Object3D[] {
    return [...[...this.nodes.values()].map((n) => n.hit), ...this.portals.map((p) => p.hit)];
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      // CSS2DObject は自分が外されたときしか DOM 要素を消さないので、ここで消す
      if (o instanceof CSS2DObject) o.element.remove();
      if (o instanceof THREE.Mesh || o instanceof Line2 || o instanceof THREE.Sprite) {
        // Sprite のジオメトリは three.js 内で共有されている
        if (o.geometry !== hitGeometry && !(o instanceof THREE.Sprite)) o.geometry.dispose();
        const m = o.material as THREE.Material;
        if (m !== hitMaterial) m.dispose();
      }
    });
  }
}
