import { describe, expect, it } from "vitest";
import sample from "../../samples/math.v1.json";
import type { TreeDoc } from "../model/schema";
import { indexTree } from "../model/tree";
import { removeNode } from "../model/ops";
import { back, enter, goTo, hopPath, initialNav, reconcile, select, up } from "./navigation";

const ix = indexTree(sample as TreeDoc);

describe("navigation", () => {
  it("入って戻ると、入った分野が選ばれ視点も戻る", () => {
    let s = select(initialNav(), "math");
    s = enter(s, "math", { x: 1, y: 2, dist: 900 });
    expect(s.place).toEqual({ levelId: "math", selectedId: null });
    s = enter(select(s, "analysis"), "analysis");
    s = back(s);
    expect(s.place).toMatchObject({ levelId: "math", selectedId: "analysis" });
    s = back(s);
    expect(s.place).toEqual({ levelId: null, selectedId: "math", view: { x: 1, y: 2, dist: 900 } });
    expect(back(s)).toBe(s);
  });

  it("別の枝へ移動して、戻ると元の場所に帰る", () => {
    let s = enter(enter(initialNav(), "math"), "analysis");
    s = enter(select(s, "multivar"), "multivar");
    s = select(s, "gradient");
    s = goTo(ix, s, "gd");
    expect(s.place).toEqual({ levelId: "ml", selectedId: "gd" });
    s = back(s);
    expect(s.place).toMatchObject({ levelId: "multivar", selectedId: "gradient" });
  });

  it("上の階層へ上がると、通ってきた子が選ばれる", () => {
    const s0 = enter(enter(enter(initialNav(), "math"), "analysis"), "multivar");
    expect(up(ix, s0, "math").place).toEqual({ levelId: "math", selectedId: "analysis" });
    expect(up(ix, s0, null).place).toEqual({ levelId: null, selectedId: "math" });
    expect(up(ix, s0, "ml")).toBe(s0);
  });

  it("消えたノードを参照しない状態に直す", () => {
    let s = enter(select(enter(initialNav(), "math"), "analysis"), "analysis");
    s = select(s, "derivative");
    const fixed = reconcile(indexTree(removeNode(sample as TreeDoc, "analysis")), s);
    expect(fixed.place).toEqual({ levelId: null, selectedId: null });
    expect(fixed.history.map((p) => p.selectedId)).toEqual(["math", null]);
    expect(reconcile(ix, s)).toBe(s);
  });
});

describe("hopPath", () => {
  it("共通の祖先まで出てから入る", () => {
    expect(hopPath(ix, "multivar", "ml")).toEqual([
      { kind: "exit", nodeId: "multivar" },
      { kind: "exit", nodeId: "analysis" },
      { kind: "exit", nodeId: "math" },
      { kind: "enter", nodeId: "ml" },
    ]);
    expect(hopPath(ix, "analysis", "linalg")).toEqual([
      { kind: "exit", nodeId: "analysis" },
      { kind: "enter", nodeId: "linalg" },
    ]);
    expect(hopPath(ix, null, "multivar").map((h) => h.nodeId)).toEqual([
      "math",
      "analysis",
      "multivar",
    ]);
    expect(hopPath(ix, "math", "math")).toEqual([]);
  });
});
