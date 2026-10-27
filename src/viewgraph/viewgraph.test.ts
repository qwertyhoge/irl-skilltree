import { describe, expect, it } from "vitest";
import sample from "../../samples/math.v1.json";
import type { TreeDoc } from "../model/schema";
import { indexTree } from "../model/tree";
import { buildLevelView, liftTo, relationsAround } from "./viewgraph";

const ix = indexTree(sample as TreeDoc);

describe("liftTo", () => {
  it("階層直下の祖先に持ち上げる", () => {
    expect(liftTo(ix, null, "gradient")).toBe("math");
    expect(liftTo(ix, "math", "gradient")).toBe("analysis");
    expect(liftTo(ix, "analysis", "gradient")).toBe("multivar");
    expect(liftTo(ix, "multivar", "gradient")).toBe("gradient");
    expect(liftTo(ix, "analysis", "matrices")).toBeNull();
    expect(liftTo(ix, "analysis", "analysis")).toBeNull();
  });
});

describe("buildLevelView", () => {
  it("ルートでは分野間の関係を種類別に集約する", () => {
    const v = buildLevelView(ix, null);
    expect(v.nodes.map((n) => n.id)).toEqual(["math", "ml", "prog"]);
    const mathMl = v.edges.find(
      (e) => e.from === "math" && e.to === "ml" && e.type === "prerequisite",
    )!;
    expect(mathMl.relations.map((r) => r.id).sort()).toEqual(
      ["r-grad-gd", "r-mat-linreg", "r-partial-bp", "r-svd-pca"].sort(),
    );
    expect(mathMl.direct).toBe(false);
    expect(v.portals).toEqual([]);
  });

  it("内部で閉じた関係は線にしない", () => {
    const v = buildLevelView(ix, "math");
    expect(v.edges.some((e) => e.from === e.to)).toBe(false);
    const e = v.edges.find(
      (x) => x.from === "elem" && x.to === "analysis" && x.type === "prerequisite",
    )!;
    expect(e.direct).toBe(true);
    expect(e.relations.map((r) => r.id)).toEqual(
      expect.arrayContaining(["r-elem-analysis", "r-seq-limit", "r-func-limit"]),
    );
  });

  it("階層の外への接続は件数を数え、選択中ノードの分だけポータルにする", () => {
    const none = buildLevelView(ix, "multivar");
    expect(none.portals).toEqual([]);
    expect(none.nodes.find((n) => n.id === "gradient")!.externalCount).toBe(2);

    const v = buildLevelView(ix, "multivar", "gradient");
    expect(v.portals).toHaveLength(2);
    const gd = v.portals.find((p) => p.targetId === "gd")!;
    expect(gd).toMatchObject({
      anchorId: "gradient",
      direction: "out",
      type: "prerequisite",
      targetTitle: "勾配降下法",
      targetPath: ["機械学習"],
    });
    const vec = v.portals.find((p) => p.targetId === "vectors")!;
    expect(vec).toMatchObject({
      direction: "in",
      type: "related",
      targetPath: ["数学", "線形代数"],
    });
  });

  it("空の分野は空の階層になる", () => {
    const v = buildLevelView(ix, "geometry");
    expect(v.nodes).toEqual([]);
    expect(v.edges).toEqual([]);
  });
});

describe("relationsAround", () => {
  it("分野を選ぶと、内部から外へ出る関係を含めて返す", () => {
    const rs = relationsAround(ix, "multivar");
    const ids = rs.map((r) => r.relation.id);
    expect(ids).toEqual(
      expect.arrayContaining(["r-diff-partial", "r-grad-gd", "r-partial-bp", "r-vec-grad"]),
    );
    expect(ids).not.toContain("r-partial-grad");
    expect(rs.find((r) => r.relation.id === "r-diff-partial")).toMatchObject({
      direction: "in",
      otherId: "derivative",
      inner: false,
    });
  });
});
