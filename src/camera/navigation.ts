import { ancestorsOf, type TreeIndex } from "../model/tree";

// どこを見ているか（意図）と、戻るための履歴。描画やアニメーションから独立している。

/** 階層ローカル座標でのカメラ。戻ったときに元の視点を復元するために保存する */
export interface CameraView {
  x: number;
  y: number;
  dist: number;
}

export interface Place {
  /** 表示している階層（この分野の直下）。null はルート */
  levelId: string | null;
  selectedId: string | null;
  view?: CameraView;
}

export interface NavState {
  place: Place;
  /** 「戻る」で帰る場所。入る・移動・上の階層へ、で積む */
  history: Place[];
}

export const HISTORY_LIMIT = 50;

export const initialNav = (): NavState => ({
  place: { levelId: null, selectedId: null },
  history: [],
});

const push = (s: NavState, next: Place, leaving: Place): NavState => ({
  place: next,
  history: [...s.history, leaving].slice(-HISTORY_LIMIT),
});

export function select(s: NavState, id: string | null): NavState {
  if (s.place.selectedId === id) return s;
  return { ...s, place: { levelId: s.place.levelId, selectedId: id } };
}

/** 分野の中へ入る。戻ったときはその分野が選ばれた状態に戻す */
export function enter(s: NavState, groupId: string, leavingView?: CameraView): NavState {
  return push(
    s,
    { levelId: groupId, selectedId: null },
    { levelId: s.place.levelId, selectedId: groupId, view: leavingView },
  );
}

/** 任意のノードへ移動し、それを選ぶ（別の枝への移動） */
export function goTo(
  ix: TreeIndex,
  s: NavState,
  nodeId: string,
  leavingView?: CameraView,
): NavState {
  const node = ix.byId.get(nodeId);
  if (!node) return s;
  return push(s, { levelId: node.parentId, selectedId: nodeId }, { ...s.place, view: leavingView });
}

/** 祖先の階層へ上がる。通ってきた子を選んだ状態にして、来た道が分かるようにする */
export function up(
  ix: TreeIndex,
  s: NavState,
  levelId: string | null,
  leavingView?: CameraView,
): NavState {
  const cur = s.place.levelId;
  if (cur === levelId) return s;
  const chain = cur === null ? [] : [...ancestorsOf(ix, cur).map((n) => n.id), cur];
  const at = levelId === null ? -1 : chain.indexOf(levelId);
  if (levelId !== null && at < 0) return s;
  const via = chain[at + 1] ?? null;
  return push(s, { levelId, selectedId: via }, { ...s.place, view: leavingView });
}

export function back(s: NavState): NavState {
  if (s.history.length === 0) return s;
  return { place: s.history[s.history.length - 1], history: s.history.slice(0, -1) };
}

/** 編集で消えたノードを参照しないように直す */
export function reconcile(ix: TreeIndex, s: NavState): NavState {
  const fix = (p: Place): Place | null => {
    if (p.levelId !== null && ix.byId.get(p.levelId)?.kind !== "group") return null;
    const sel =
      p.selectedId !== null && ix.byId.get(p.selectedId)?.parentId === p.levelId
        ? p.selectedId
        : null;
    return sel === p.selectedId ? p : { levelId: p.levelId, selectedId: sel, view: p.view };
  };
  const place = fix(s.place) ?? { levelId: null, selectedId: null };
  const history = s.history.map(fix).filter((p): p is Place => p !== null);
  if (
    place === s.place &&
    history.length === s.history.length &&
    history.every((p, i) => p === s.history[i])
  )
    return s;
  return { place, history };
}

export type Hop = { kind: "enter"; nodeId: string } | { kind: "exit"; nodeId: string };

/** 階層 from から to へ、一階層ずつの出入りの列。共通の祖先まで出てから入る */
export function hopPath(ix: TreeIndex, from: string | null, to: string | null): Hop[] {
  const chain = (id: string | null) =>
    id === null ? [] : [...ancestorsOf(ix, id).map((n) => n.id), id];
  const a = chain(from);
  const b = chain(to);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  const hops: Hop[] = [];
  for (let i = a.length - 1; i >= common; i--) hops.push({ kind: "exit", nodeId: a[i] });
  for (let i = common; i < b.length; i++) hops.push({ kind: "enter", nodeId: b[i] });
  return hops;
}
