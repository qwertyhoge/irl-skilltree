import type { TreeDoc } from "../model/schema";
import { validateTree } from "../model/validate";

// 作業中のツリーをブラウザに自動保存する。ファイルへの書き出しとは別で、
// dirty は「最後にファイルを開く・書き出してから変更があるか」を表す。

const KEY = "irl-skilltree:v1:working";

export interface Working {
  doc: TreeDoc;
  dirty: boolean;
}

export function loadWorking(): Working | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { doc: unknown; dirty: unknown };
    const result = validateTree(parsed.doc);
    if (!result.ok) return null;
    return { doc: result.doc, dirty: parsed.dirty === true };
  } catch {
    return null;
  }
}

/** 保存できたかを返す。プライベートモードや容量超過では false */
export function saveWorking(w: Working): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
    return true;
  } catch {
    return false;
  }
}
