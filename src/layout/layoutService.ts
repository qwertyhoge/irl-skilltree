import ELK from "elkjs/lib/elk-api";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import type { LevelView } from "../viewgraph/viewgraph";
import { layoutLevel, nodeBox, type LevelLayout } from "./elkLayout";

// ELK を Worker で動かし、同じ構造の階層は計算し直さない。

const elk = new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
const cache = new Map<string, Promise<LevelLayout>>();
const CACHE_LIMIT = 200;

/** 配置に影響する情報だけからキーを作る（説明文の編集では作り直さない） */
export function layoutKey(view: LevelView): string {
  const nodes = view.nodes.map((n) => `${n.id}:${nodeBox(n).width}x${nodeBox(n).height}`).join(",");
  const edges = view.edges
    .filter((e) => e.type === "prerequisite")
    .map((e) => `${e.from}>${e.to}`)
    .join(",");
  return `${view.levelId ?? ""}|${nodes}|${edges}`;
}

export function getLayout(view: LevelView): Promise<LevelLayout> {
  const key = layoutKey(view);
  let hit = cache.get(key);
  if (!hit) {
    hit = layoutLevel(elk, view);
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  return hit;
}
