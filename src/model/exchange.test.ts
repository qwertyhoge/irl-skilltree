import { describe, expect, it } from "vitest";
import sample from "../../samples/math.v1.json";
import type { TreeDoc } from "./schema";
import { extractBranch, importBranch } from "./exchange";
import { validateTree } from "./validate";
import { indexTree } from "./tree";
import { addRelation, removeNode, setParent } from "./ops";

const base = (): TreeDoc => structuredClone(sample) as TreeDoc;
const empty = (): TreeDoc => ({
  schemaVersion: 1,
  id: "mine",
  title: "自分のツリー",
  nodes: [],
  relations: [],
  achievements: [],
});

describe("extractBranch", () => {
  it("drop: 範囲外へのリンクを削除し、報告に載せる", () => {
    const { doc, report } = extractBranch(base(), "analysis", "drop");
    expect(validateTree(doc).ok).toBe(true);
    expect(doc.nodes.find((n) => n.id === "analysis")?.parentId).toBeNull();
    expect(doc.nodes.map((n) => n.id)).toContain("gradient");
    expect(doc.nodes.map((n) => n.id)).not.toContain("matrices");
    const dropped = report.dropped.map((r) => r.id);
    expect(dropped).toEqual(
      expect.arrayContaining(["r-seq-limit", "r-grad-gd", "r-elem-analysis"]),
    );
    expect(doc.relations.map((r) => r.id)).toContain("r-limit-diff");
    expect(doc.relations.map((r) => r.id)).not.toContain("r-grad-gd");
  });

  it("keep-external: 範囲外の端点を所属付きの参照として残す", () => {
    const { doc, report } = extractBranch(base(), "analysis", "keep-external");
    expect(validateTree(doc).ok).toBe(true);
    const gd = doc.relations.find((r) => r.id === "r-grad-gd")!;
    expect(gd.external).toEqual({ treeId: "sample-math", title: "勾配降下法", path: ["機械学習"] });
    expect(report.keptAsExternal.length).toBe(report.dropped.length + report.keptAsExternal.length);
    expect(report.dropped).toEqual([]);
  });

  it("範囲外のスキルを含む実績は、範囲内のスキルに絞って報告する", () => {
    const { doc, report } = extractBranch(base(), "linalg", "drop");
    expect(doc.achievements.find((a) => a.id === "a-linreg-scratch")?.skillIds).toEqual([
      "matrices",
    ]);
    expect(report.trimmedAchievements).toContain("線形回帰をゼロから実装");
  });
});

describe("importBranch", () => {
  it("枝をコピーし、取り込み元を残す", () => {
    const { doc, report } = importBranch(empty(), base(), "linalg", null);
    expect(validateTree(doc).ok).toBe(true);
    expect(doc.nodes).toHaveLength(6);
    expect(doc.nodes.find((n) => n.id === "linalg")).toMatchObject({
      parentId: null,
      origin: { treeId: "sample-math", nodeId: "linalg" },
    });
    expect(doc.sources).toEqual([
      { treeId: "sample-math", title: "数学から機械学習へ（サンプル）" },
    ]);
    expect(report.skippedRelations.map((r) => r.id)).toEqual(
      expect.arrayContaining(["r-mat-linreg", "r-elem-linalg"]),
    );
  });

  it("ID が衝突したら付け替え、親子と関係の参照も書き換える", () => {
    const target = base();
    const { doc, report } = importBranch(target, base(), "multivar", "linalg");
    expect(validateTree(doc).ok).toBe(true);
    expect(report.renamed).toEqual(
      expect.arrayContaining([
        { from: "multivar", to: "multivar-2" },
        { from: "partial", to: "partial-2" },
      ]),
    );
    const copy = doc.nodes.find((n) => n.id === "partial-2")!;
    expect(copy.parentId).toBe("multivar-2");
    expect(doc.nodes.find((n) => n.id === "multivar-2")!.parentId).toBe("linalg");
    const rel = doc.relations.find((r) => r.from === "partial-2" && r.to === "gradient-2");
    expect(rel).toBeDefined();
    expect(target.nodes).toHaveLength(base().nodes.length); // 元は変更しない
  });

  it("以前に取り込んだノードが範囲外の相手なら、つなぎ直す", () => {
    const first = importBranch(empty(), base(), "linalg", null).doc;
    const { doc, report } = importBranch(first, base(), "ml", null);
    expect(validateTree(doc).ok).toBe(true);
    expect(report.reconnectedRelations.map((r) => r.id)).toEqual(
      expect.arrayContaining(["r-mat-linreg", "r-svd-pca"]),
    );
    expect(doc.relations.some((r) => r.from === "matrices" && r.to === "linreg")).toBe(true);
  });

  it("書き出した枝を取り込むと external 参照は外れ、取り込まなかった扱いになる", () => {
    const branch = extractBranch(base(), "ml", "keep-external").doc;
    const { doc, report } = importBranch(empty(), branch, null, null);
    expect(validateTree(doc).ok).toBe(true);
    expect(doc.relations.every((r) => !r.external)).toBe(true);
    expect(report.skippedRelations.length).toBeGreaterThan(0);
  });
});

describe("ops", () => {
  it("自分の内部を親にできない", () => {
    expect(setParent(base(), "analysis", "multivar")).toBeTypeOf("string");
    expect(setParent(base(), "analysis", "derivative")).toBeTypeOf("string");
    const moved = setParent(base(), "multivar", "linalg");
    expect(typeof moved === "object" && validateTree(moved).ok).toBe(true);
  });

  it("削除は内部と関係する線もまとめて消す", () => {
    const doc = removeNode(base(), "analysis");
    expect(validateTree(doc).ok).toBe(true);
    expect(indexTree(doc).byId.has("gradient")).toBe(false);
    expect(doc.relations.some((r) => r.id === "r-grad-gd")).toBe(false);
  });

  it("同じ関係の重複と自己参照を断る", () => {
    expect(addRelation(base(), "prerequisite", "limits", "derivative")).toBeTypeOf("string");
    expect(addRelation(base(), "related", "limits", "limits")).toBeTypeOf("string");
    expect(addRelation(base(), "related", "limits", "pca")).toBeTypeOf("object");
  });
});
