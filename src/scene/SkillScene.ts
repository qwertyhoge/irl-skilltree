import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { TreeIndex } from "../model/tree";
import { ancestorsOf } from "../model/tree";
import { buildLevelView } from "../viewgraph/viewgraph";
import { getLayout } from "../layout/layoutService";
import { hopPath, type CameraView, type Hop, type Place } from "../camera/navigation";
import { easings, smoothstep } from "../camera/easing";
import { tuning } from "../tuning";
import { BRANCH_COLORS, LevelFrame, ORB } from "./frame";

// 探索空間の描画と遷移。意図（Place）を受け取り、現在地からそこへ一階層ずつ動く。
//
// 座標の約束:
// - base は今いる階層のフレームで、常に原点・縮尺 1 に置く。
// - 子の階層は親ノードの球の内側に縮尺 k で置く。入り終えたら子を基準に全体を置き直す（rebase）。
// - 出入りの進み具合はカメラ距離から求める。途中で引き返しても見た目が距離と一致する。

export interface SceneEvents {
  select(id: string | null): void;
  enter(id: string): void;
  portal(targetId: string): void;
}

interface WorldView {
  target: THREE.Vector3;
  dist: number;
}

interface Transition {
  outer: LevelFrame;
  inner: LevelFrame;
  hostId: string;
  dest: "outer" | "inner";
  outerView: WorldView;
  innerView: WorldView;
}

interface Tween {
  from: { t: THREE.Vector3; ld: number };
  to: { t: THREE.Vector3; ld: number };
  start: number;
  dur: number;
  ease: (u: number) => number;
  done?: () => void;
}

/** 選択時に寄る距離の下限（ポータルの扇が収まる程度） */
const SELECT_MIN_DIST = 900;

const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");

export class SkillScene {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  private labels = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(tuning.fovDeg, 1, 1, 1e6);
  private stars: THREE.Group;
  private starAnchor = new THREE.Vector3();
  private starRef = 1000;

  private ix!: TreeIndex;
  private version = 0;
  private base: LevelFrame | null = null;
  private transition: Transition | null = null;
  private intent: Place = { levelId: null, selectedId: null };
  private focusedKey = "";
  private portalKey = "";

  private cam = { target: new THREE.Vector3(), dist: 1000 };
  private tween: Tween | null = null;
  private insets = { right: 0, bottom: 0 };
  private offset = { x: 0, y: 0 };
  private size = { w: 1, h: 1 };
  private hovered: string | null = null;
  private pumping = false;
  private pumpAgain = false;
  private raf = 0;
  private last = performance.now();
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private events: SceneEvents,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x060914);
    this.renderer.domElement.className = "scene-canvas";
    this.labels.domElement.className = "scene-labels";
    container.append(this.renderer.domElement, this.labels.domElement);
    this.stars = makeStars();
    this.scene.add(this.stars);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindInput();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- 公開 API

  /** 木が変わった（読み込み・編集）。遷移中なら終点へ飛ばしてから作り直す */
  async setTree(ix: TreeIndex) {
    const first = !this.ix;
    this.ix = ix;
    const v = ++this.version;
    if (this.transition) this.finishTransition(true);
    const levelOk = (id: string | null) => id === null || ix.byId.get(id)?.kind === "group";
    const levelId =
      this.base && levelOk(this.base.levelId)
        ? this.base.levelId
        : levelOk(this.intent.levelId)
          ? this.intent.levelId
          : null;
    const frame = await this.buildFrame(levelId);
    if (v !== this.version || this.disposed) return frame.dispose();
    const old = this.base;
    this.base = frame;
    this.scene.add(frame.root);
    old?.dispose();
    this.portalKey = "";
    if (first || !old || old.levelId !== levelId) {
      const view = this.viewFor(
        frame,
        this.intent.levelId === levelId ? this.intent : { levelId, selectedId: null },
      );
      this.cam.target.copy(view.target);
      this.cam.dist = view.dist;
      this.tween = null;
      this.focusedKey = this.keyOf(this.intent);
    }
    void this.pump();
  }

  setIntent(place: Place) {
    this.intent = place;
    void this.pump();
  }

  /** 説明パネルが覆う幅・高さ。視点の中心をずらし、選択ノードが隠れないようにする */
  setInsets(right: number, bottom: number) {
    if (right === this.insets.right && bottom === this.insets.bottom) return;
    this.insets = { right, bottom };
    if (!this.transition && this.base) {
      this.focusedKey = "";
      void this.pump();
    }
  }

  /** 今の階層での視点。戻ったときに復元するために履歴へ保存する */
  currentView(): CameraView | undefined {
    if (this.transition || !this.base) return undefined;
    return { x: this.cam.target.x, y: this.cam.target.y, dist: this.cam.dist };
  }

  /** 検証用: ノードの画面上の位置 */
  screenOf(id: string): { x: number; y: number } | null {
    const n = this.base?.nodes.get(id) ?? this.base?.portals.find((p) => p.portal.targetId === id);
    if (!n) return null;
    const p = n.group.getWorldPosition(new THREE.Vector3()).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** 検証用: 遷移が落ち着いているか、どこにいるか */
  state() {
    return {
      levelId: this.base?.levelId ?? null,
      transitioning:
        !!this.transition ||
        !!this.tween ||
        Math.abs(this.offset.x - this.insets.right / 2) > 0.5 ||
        Math.abs(this.offset.y - this.insets.bottom / 2) > 0.5,
      intent: this.intent,
      portals: this.base?.portals.map((p) => p.portal.targetId) ?? [],
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.base?.dispose();
    this.transition?.outer.dispose();
    this.transition?.inner.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  // ---------------------------------------------------------------- 遷移

  private motion() {
    const reduce = reducedMotionQuery.matches;
    return {
      reduce,
      selectMs: reduce ? 180 : tuning.selectMs,
      diveMs: reduce ? 260 : tuning.diveMs,
      hopMinMs: reduce ? 200 : tuning.hopMinMs,
      floatAmp: reduce ? 0 : tuning.floatAmp,
      breatheAmp: reduce ? 0 : tuning.breatheAmp,
      spreadFrom: reduce ? 1 : tuning.innerSpreadFrom,
      stagger: reduce ? 0 : tuning.innerStagger,
    };
  }

  private keyOf(p: Place) {
    return `${p.levelId}|${p.selectedId}|${p.view ? `${p.view.x},${p.view.y},${p.view.dist}` : ""}|${this.insets.right},${this.insets.bottom}`;
  }

  /** 意図に向かって一歩進める。非同期の構築を挟むので直列に実行する */
  private async pump() {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        await this.step();
      } while (this.pumpAgain && !this.disposed);
    } finally {
      this.pumping = false;
    }
  }

  private async step() {
    if (!this.base || !this.ix) return;
    const m = this.motion();
    const tr = this.transition;
    if (tr) {
      const heading = tr.dest === "inner" ? tr.inner.levelId : tr.outer.levelId;
      const path = hopPath(this.ix, heading, this.intent.levelId);
      if (path.length === 0) return; // 着いてから選択に合わせる
      const reverses =
        (tr.dest === "inner" && path[0].kind === "exit" && path[0].nodeId === tr.inner.levelId) ||
        (tr.dest === "outer" && path[0].kind === "enter" && path[0].nodeId === tr.inner.levelId);
      if (reverses) {
        // 引き返す。進み具合はカメラ距離で決まるので、目標を差し替えるだけで逆再生になる
        tr.dest = tr.dest === "inner" ? "outer" : "inner";
        const to = tr.dest === "inner" ? tr.innerView : tr.outerView;
        this.flyTo(to, m.diveMs * 0.75, easings[tuning.diveEase], () => this.finishTransition());
      } else if (this.tween) {
        // 先へ進む途中の一段は、残りを短くして次へつなぐ
        const remaining = this.tween.dur - (performance.now() - this.tween.start);
        if (remaining > m.hopMinMs * 0.6) {
          const to = tr.dest === "inner" ? tr.innerView : tr.outerView;
          this.flyTo(to, m.hopMinMs * 0.6, easings.outCubic, () => this.finishTransition());
        }
      }
      return;
    }

    const path = hopPath(this.ix, this.base.levelId, this.intent.levelId);
    if (path.length === 0) {
      this.syncPortals();
      const key = this.keyOf(this.intent);
      if (key === this.focusedKey) return;
      this.focusedKey = key;
      const view = this.viewFor(this.base, this.intent);
      this.flyTo(view, m.selectMs, easings[tuning.selectEase]);
      return;
    }
    const dur =
      path.length === 1 ? m.diveMs : Math.max(m.hopMinMs, m.diveMs / Math.sqrt(path.length));
    await this.startHop(path[0], path.length === 1, dur);
  }

  private async startHop(hop: Hop, final: boolean, dur: number) {
    const base = this.base!;
    const v = this.version;
    base.setPortals([], performance.now());
    this.portalKey = "";
    if (hop.kind === "enter") {
      const host = base.nodes.get(hop.nodeId);
      const inner = await this.buildFrame(hop.nodeId);
      if (v !== this.version || this.disposed || !host || this.base !== base)
        return inner.dispose();
      const k = (tuning.innerFit * ORB) / inner.layout.radius;
      inner.root.position.copy(host.base);
      inner.root.scale.setScalar(k);
      inner.opacity = 0;
      inner.appear = 0;
      this.scene.add(inner.root);
      const innerView = this.viewFor(
        inner,
        final ? this.intent : { levelId: hop.nodeId, selectedId: null },
      );
      this.transition = {
        outer: base,
        inner,
        hostId: hop.nodeId,
        dest: "inner",
        outerView: { target: this.cam.target.clone(), dist: this.cam.dist },
        innerView,
      };
      this.flyTo(innerView, dur, easings[tuning.diveEase], () => this.finishTransition());
    } else {
      const parentId = this.ix.byId.get(hop.nodeId)?.parentId ?? null;
      const outer = await this.buildFrame(parentId);
      const host = outer.nodes.get(hop.nodeId);
      if (v !== this.version || this.disposed || !host || this.base !== base)
        return outer.dispose();
      const k = (tuning.innerFit * ORB) / base.layout.radius;
      outer.root.scale.setScalar(1 / k);
      outer.root.position.copy(host.base).multiplyScalar(-1 / k);
      outer.opacity = 0;
      this.scene.add(outer.root);
      const outerView = this.viewFor(
        outer,
        final ? this.intent : { levelId: parentId, selectedId: hop.nodeId },
      );
      this.transition = {
        outer,
        inner: base,
        hostId: hop.nodeId,
        dest: "outer",
        outerView,
        innerView: { target: this.cam.target.clone(), dist: this.cam.dist },
      };
      this.flyTo(outerView, dur, easings[tuning.diveEase], () => this.finishTransition());
    }
    if (final) this.focusedKey = this.keyOf(this.intent);
  }

  /** 遷移を終える。immediate なら目標の視点へ飛ぶ */
  private finishTransition(immediate = false) {
    const tr = this.transition;
    if (!tr) return;
    const dest = tr.dest === "inner" ? tr.inner : tr.outer;
    const other = tr.dest === "inner" ? tr.outer : tr.inner;
    if (immediate) {
      const to = tr.dest === "inner" ? tr.innerView : tr.outerView;
      this.cam.target.copy(to.target);
      this.cam.dist = to.dist;
    }
    this.tween = null;
    this.transition = null;
    if (dest !== this.base) this.rebase(dest);
    this.base = dest;
    dest.opacity = 1;
    dest.appear = 1;
    other.dispose();
    this.portalKey = "";
    if (!immediate) void this.pump();
  }

  /** frame を原点・縮尺 1 に置き直し、カメラも同じ変換で動かす（見た目は変わらない） */
  private rebase(frame: LevelFrame) {
    const s = frame.root.scale.x;
    const o = frame.root.position.clone();
    const frames = new Set([this.base, this.transition?.outer, this.transition?.inner, frame]);
    for (const f of frames) {
      if (!f) continue;
      f.root.position.sub(o).divideScalar(s);
      f.root.scale.divideScalar(s);
    }
    this.cam.target.sub(o).divideScalar(s);
    this.cam.dist /= s;
    this.starAnchor.sub(o).divideScalar(s);
    this.starRef /= s;
  }

  private async buildFrame(levelId: string | null): Promise<LevelFrame> {
    const ix = this.ix;
    const view = buildLevelView(ix, levelId);
    const layout = await getLayout(view);
    const frame = new LevelFrame(levelId, view, layout, (id) => this.colorOf(ix, id));
    frame.setResolution(this.size.w, this.size.h);
    return frame;
  }

  private colorOf(ix: TreeIndex, id: string): number {
    const top = ancestorsOf(ix, id)[0]?.id ?? id;
    const roots = ix.children.get(null) ?? [];
    const i = Math.max(0, roots.indexOf(top));
    return BRANCH_COLORS[i % BRANCH_COLORS.length];
  }

  /** 選択中ノードの外部接続を出す（落ち着いているときだけ） */
  private syncPortals() {
    const base = this.base!;
    const sel = this.intent.levelId === base.levelId ? this.intent.selectedId : null;
    const key = `${base.levelId}|${sel}`;
    if (key === this.portalKey) return;
    this.portalKey = key;
    const portals = sel ? buildLevelView(this.ix, base.levelId, sel).portals : [];
    base.setPortals(portals, performance.now());
    base.setResolution(this.size.w, this.size.h);
  }

  // ---------------------------------------------------------------- カメラ

  /** 階層全体が、パネルを除いた領域に収まる距離（フレーム縮尺 1 のとき） */
  private fitDistance(frame: LevelFrame): number {
    const tan = Math.tan(THREE.MathUtils.degToRad(tuning.fovDeg) / 2);
    const { w, h } = this.size;
    const availW = Math.max(200, w - this.insets.right) / w;
    const availH = Math.max(200, h - this.insets.bottom) / h;
    const margin = 90;
    const lw = frame.layout.width + margin * 2;
    const lh = frame.layout.height + margin * 2 + 40;
    return Math.max(520, lh / (2 * tan * availH), lw / (2 * tan * (w / h) * availW));
  }

  private viewFor(frame: LevelFrame, place: Place): WorldView {
    const s = frame.root.scale.x;
    const fit = this.fitDistance(frame);
    let x = 0;
    let y = 0;
    let dist = fit;
    if (place.view && place.levelId === frame.levelId) {
      ({ x, y, dist } = place.view);
    } else if (place.selectedId && frame.nodes.has(place.selectedId)) {
      const n = frame.nodes.get(place.selectedId)!;
      x = n.base.x;
      y = n.base.y;
      // 寄りすぎると周りのつながりやポータルが画面外に出るので、下限を設ける
      dist = Math.min(fit, Math.max(fit * tuning.selectZoom, SELECT_MIN_DIST));
      // 手動で寄っている場合は、極端に引かない
      if (frame === this.base && !this.transition) {
        const cur = this.cam.dist / s;
        if (cur < dist && cur > fit * 0.3) dist = cur;
      }
    }
    return {
      target: frame.root.position.clone().add(new THREE.Vector3(x * s, y * s, 0)),
      dist: dist * s,
    };
  }

  private flyTo(to: WorldView, dur: number, ease: (u: number) => number, done?: () => void) {
    // 途中で呼ばれても、現在の値から目標を差し替える
    this.tween = {
      from: { t: this.cam.target.clone(), ld: Math.log(this.cam.dist) },
      to: { t: to.target.clone(), ld: Math.log(to.dist) },
      start: performance.now(),
      dur: Math.max(1, dur),
      ease,
      done,
    };
  }

  // ---------------------------------------------------------------- 毎フレーム

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(64, now - this.last);
    this.last = now;
    if (!this.base) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const m = this.motion();

    if (this.tween) {
      const tw = this.tween;
      const u = Math.min(1, (now - tw.start) / tw.dur);
      const e = tw.ease(u);
      this.cam.target.lerpVectors(tw.from.t, tw.to.t, e);
      this.cam.dist = Math.exp(THREE.MathUtils.lerp(tw.from.ld, tw.to.ld, e));
      if (u >= 1) {
        this.tween = null;
        tw.done?.();
      }
    }

    // パネルの分だけ投影の中心をずらす（なめらかに追従）
    const k = 1 - Math.exp(-dt / 140);
    this.offset.x += (this.insets.right / 2 - this.offset.x) * k;
    this.offset.y += (this.insets.bottom / 2 - this.offset.y) * k;
    const { w, h } = this.size;
    this.camera.setViewOffset(w, h, this.offset.x, this.offset.y, w, h);

    const tilt = THREE.MathUtils.degToRad(tuning.tiltDeg);
    const c = this.cam;
    this.camera.fov = tuning.fovDeg;
    this.camera.near = c.dist * 0.02;
    this.camera.far = c.dist * 80;
    this.camera.position.set(
      c.target.x,
      c.target.y - Math.sin(tilt) * c.dist,
      c.target.z + Math.cos(tilt) * c.dist,
    );
    this.camera.lookAt(c.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    // 星空: 少し遅れて追いかけ、潜るほど外へ流れる
    this.starAnchor.lerp(c.target, 1 - Math.exp(-dt / 900));
    this.starRef += (c.dist - this.starRef) * (1 - Math.exp(-dt / 2500));
    this.stars.position.copy(this.starAnchor);
    this.stars.scale.setScalar(c.dist * Math.pow(this.starRef / c.dist, 0.25) * 0.004);

    // 出入りの進み具合（0 = 外、1 = 中）
    const tr = this.transition;
    let p = 1;
    if (tr) {
      p = Math.log(tr.outerView.dist / c.dist) / Math.log(tr.outerView.dist / tr.innerView.dist);
      p = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 1));
      tr.outer.opacity = 1 - smoothstep(tuning.outerFade[0], tuning.outerFade[1], p);
      tr.inner.opacity = 1;
      tr.inner.appear = p;
    }
    const frames = tr ? [tr.outer, tr.inner] : [this.base];
    for (const f of frames) this.updateFrame(f, now, dt, m, tr, p);

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  private updateFrame(
    f: LevelFrame,
    now: number,
    dt: number,
    m: ReturnType<SkillScene["motion"]>,
    tr: Transition | null,
    p: number,
  ) {
    const s = f.root.scale.x;
    // 画面上の大きさの基準: この階層を全体表示したときを 1 とする
    const ref = s * this.fitDistance(f);
    const isInner = !!tr && f === tr.inner;
    const isOuter = !!tr && f === tr.outer;
    const selected = !tr && this.intent.levelId === f.levelId ? this.intent.selectedId : null;
    const connected = new Set<string>();
    if (selected)
      for (const e of f.edges)
        if (e.edge.from === selected || e.edge.to === selected) connected.add(e.edge.id);
    const ease = 1 - Math.exp(-dt / 160);
    const tmp = new THREE.Vector3();

    const [a0, a1] = tuning.innerAppear;
    const spreadAll = isInner ? m.spreadFrom + (1 - m.spreadFrom) * smoothstep(a0 * 0.8, 1, p) : 1;
    f.root.visible = f.opacity > 0.005;
    if (!f.root.visible) return;

    for (const n of f.nodes.values()) {
      const delay = isInner ? n.order * m.stagger : 0;
      const appear = isInner ? smoothstep(a0 + delay, a1 + delay, p) : 1;
      const target = n.id === selected ? 1 : n.id === this.hovered && !tr ? 0.5 : 0;
      n.emphasis += (target - n.emphasis) * ease;

      const float =
        Math.sin((now / tuning.floatPeriodMs) * Math.PI * 2 + n.phase * 6.28) * m.floatAmp;
      n.group.position.set(n.base.x * spreadAll, n.base.y * spreadAll + float, n.base.z);
      const breathe =
        1 + Math.sin((now / tuning.breathePeriodMs) * Math.PI * 2 + n.phase * 9.1) * m.breatheAmp;
      const pop = 0.6 + 0.4 * appear;
      n.orb.scale.setScalar((1 + n.emphasis * 0.22) * pop);
      n.glow.scale.setScalar(ORB * (3.6 + n.emphasis * 2.6) * breathe * pop);
      (n.glow.material as THREE.SpriteMaterial).opacity =
        f.opacity * appear * (0.42 + n.emphasis * 0.45);

      let orbOpacity = f.opacity * appear;
      if (isOuter && n.id === tr!.hostId) {
        // 入っていく球は、近づくにつれて膜のように薄れ、輪が外へ広がる
        orbOpacity *= 1 - smoothstep(0.15, 0.5, p);
      }
      const hostP = isOuter && n.id === tr!.hostId ? p : 0;
      n.orb.material.opacity = orbOpacity;
      // 半透明の球が奥行きを書くと、内側の子が隠れる
      n.orb.material.depthWrite = orbOpacity > 0.98;
      if (n.ring) {
        n.ring.scale.setScalar(1 + smoothstep(0.05, 0.5, hostP) * 0.6);
        n.ring.material.opacity =
          f.opacity * appear * (0.55 + n.emphasis * 0.45) * (1 - smoothstep(0.05, 0.4, hostP));
        n.ring.rotation.z += (dt / 1000) * (m.reduce ? 0 : 0.35);
      }

      // ラベルは画面上の大きさに合わせて縮尺・不透明度を決める
      n.group.getWorldPosition(tmp);
      const scale = ref / this.camera.position.distanceTo(tmp);
      const ls = Math.min(1.3, scale);
      const op = f.opacity * appear * smoothstep(0.32, 0.6, scale);
      setStyle(n.label.element, "opacity", op.toFixed(3));
      setStyle(n.label.element, "visibility", op < 0.02 ? "hidden" : "visible");
      setStyle(n.labelInner, "transform", `scale(${ls.toFixed(3)})`);
      n.label.element.classList.toggle("is-selected", n.id === selected);
      n.label.element.classList.toggle("is-hovered", n.id === this.hovered);
    }

    f.edgeLayer.scale.setScalar(spreadAll);
    const edgeAppear = isInner ? smoothstep(a0 + m.stagger, a1 + m.stagger, p) : 1;
    const lineScale = Math.min(1.4, Math.max(0.15, ref / this.cam.dist));
    for (const e of f.edges) {
      const target = selected ? (connected.has(e.edge.id) ? 1 : -0.6) : 0;
      e.emphasis += (target - e.emphasis) * ease;
      const base = 0.55 + e.emphasis * 0.45;
      e.material.opacity = f.opacity * edgeAppear * Math.max(0.12, base);
      e.material.linewidth = e.baseWidth * (1 + Math.max(0, e.emphasis) * 0.7) * lineScale;
      if (e.arrow) e.arrow.material.opacity = e.material.opacity;
    }

    for (const pv of f.portals) {
      const age = smoothstep(0, 450, now - pv.born);
      const bob = Math.sin(now / 1200 + pv.group.position.x) * m.floatAmp * 0.6;
      pv.gem.position.y = bob;
      pv.gem.rotation.y += (dt / 1000) * (m.reduce ? 0 : 0.8);
      pv.gem.scale.setScalar(0.4 + 0.6 * age);
      pv.gem.material.opacity = f.opacity * age;
      pv.material.opacity = f.opacity * age * 0.7;
      pv.material.linewidth = 1.2 * lineScale;
      const hov = this.hovered === `portal:${pv.portal.targetId}`;
      setStyle(pv.label.element, "opacity", (f.opacity * age).toFixed(3));
      setStyle(pv.labelInner, "transform", `scale(${Math.min(1.2, lineScale).toFixed(3)})`);
      pv.label.element.classList.toggle("is-hovered", hov);
    }
  }

  // ---------------------------------------------------------------- 入力

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.size = { w, h };
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    for (const f of [this.base, this.transition?.outer, this.transition?.inner])
      f?.setResolution(w, h);
    if (this.base && !this.transition) {
      this.focusedKey = "";
      void this.pump();
    }
  }

  private pick(
    clientX: number,
    clientY: number,
  ): { nodeId?: string; portalTarget?: string } | null {
    const frame = this.transition ? null : this.base;
    if (!frame) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(frame.hitTargets(), false)[0];
    return hit ? (hit.object.userData as { nodeId?: string; portalTarget?: string }) : null;
  }

  private bindInput() {
    const el = this.renderer.domElement;
    let drag: { x: number; y: number; moved: boolean; id: number } | null = null;

    el.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX, y: ev.clientY, moved: false, id: ev.pointerId };
    });
    el.addEventListener("pointermove", (ev) => {
      if (drag && drag.id === ev.pointerId) {
        const dx = ev.clientX - drag.x;
        const dy = ev.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;
        if (!drag.moved) el.setPointerCapture(ev.pointerId);
        drag.moved = true;
        drag.x = ev.clientX;
        drag.y = ev.clientY;
        if (this.transition) return;
        this.tween = null;
        const perPx =
          (2 * Math.tan(THREE.MathUtils.degToRad(tuning.fovDeg) / 2) * this.cam.dist) / this.size.h;
        this.cam.target.x -= dx * perPx;
        this.cam.target.y += dy * perPx;
        return;
      }
      const hit = this.pick(ev.clientX, ev.clientY);
      this.hovered = hit?.nodeId ?? (hit?.portalTarget ? `portal:${hit.portalTarget}` : null);
      el.style.cursor = this.hovered ? "pointer" : "grab";
    });
    let suppressClick = false;
    el.addEventListener("pointerup", () => {
      suppressClick = !!drag?.moved;
      drag = null;
    });
    el.addEventListener("click", (ev) => {
      if (suppressClick) return;
      const hit = this.pick(ev.clientX, ev.clientY);
      if (hit?.portalTarget) this.events.portal(hit.portalTarget);
      else if (hit?.nodeId) {
        const node = this.ix.byId.get(hit.nodeId);
        // 選択済みの分野をもう一度押すと中へ入る
        if (ev.detail > 1) return; // 二度目以降は dblclick に任せる
        if (node?.kind === "group" && this.intent.selectedId === hit.nodeId)
          this.events.enter(hit.nodeId);
        else this.events.select(hit.nodeId);
      } else if (!this.transition) this.events.select(null);
    });
    el.addEventListener("dblclick", (ev) => {
      const hit = this.pick(ev.clientX, ev.clientY);
      if (
        hit?.nodeId &&
        this.ix.byId.get(hit.nodeId)?.kind === "group" &&
        this.intent.levelId === this.base?.levelId
      ) {
        this.events.enter(hit.nodeId);
      }
    });
    el.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        if (this.transition || !this.base) return;
        this.tween = null;
        const fit = this.fitDistance(this.base);
        this.cam.dist = Math.min(
          fit * 2,
          Math.max(fit * 0.22, this.cam.dist * Math.exp(ev.deltaY * 0.0015)),
        );
      },
      { passive: false },
    );
  }
}

function setStyle(el: HTMLElement, prop: "opacity" | "transform" | "visibility", value: string) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

function makeStars(): THREE.Group {
  const group = new THREE.Group();
  const layers: [number, number, number][] = [
    [1400, 1.6, 0.55],
    [500, 2.4, 0.8],
  ];
  for (const [count, size, opacity] of layers) {
    const pts = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // 原点を囲む厚い殻に散らす（カメラの手前にも奥にも来る）
      const r = 250 + Math.random() * 900;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pts.set(
        [r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph) - 300],
        i * 3,
      );
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    group.add(
      new THREE.Points(
        g,
        new THREE.PointsMaterial({
          color: 0x9fb0e8,
          size,
          sizeAttenuation: false,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      ),
    );
  }
  return group;
}
