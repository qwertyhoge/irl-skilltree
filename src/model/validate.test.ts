import { describe, expect, it } from "vitest";
import sample from "../../samples/math.v1.json";
import { validateTree } from "./validate";
import type { TreeDoc } from "./schema";

const base = (): TreeDoc => structuredClone(sample) as TreeDoc;
const codes = (input: unknown) => validateTree(input).issues.map((i) => i.code);

describe("validateTree", () => {
  it("サンプルは警告なしで通る", () => {
    const r = validateTree(sample);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("スキーマ違反を拒否する", () => {
    expect(validateTree({ ...base(), schemaVersion: 2 }).ok).toBe(false);
    expect(
      validateTree({ ...base(), relations: [{ id: "x", type: "unlocks", from: "a", to: "b" }] }).ok,
    ).toBe(false);
    expect(validateTree(null).ok).toBe(false);
  });

  it("ID の重複を検出する（ノードと関係の間でも）", () => {
    const doc = base();
    doc.relations[0].id = "math";
    expect(codes(doc)).toContain("duplicate-id");
  });

  it("存在しない親・分野でない親を検出する", () => {
    const doc = base();
    doc.nodes.push({ id: "x", kind: "skill", parentId: "nowhere", title: "X" });
    doc.nodes.push({ id: "y", kind: "skill", parentId: "derivative", title: "Y" });
    expect(codes(doc)).toEqual(expect.arrayContaining(["missing-parent", "parent-not-group"]));
  });

  it("包含の循環を検出する", () => {
    const doc = base();
    doc.nodes.find((n) => n.id === "math")!.parentId = "multivar";
    const r = validateTree(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.find((i) => i.code === "containment-cycle")?.ids).toEqual(
      expect.arrayContaining(["math", "analysis", "multivar"]),
    );
  });

  it("存在しない端点を拒否し、external 付きなら片側だけ許す", () => {
    const doc = base();
    doc.relations.push({ id: "rx", type: "related", from: "limits", to: "ghost" });
    expect(codes(doc)).toContain("missing-endpoint");
    doc.relations[doc.relations.length - 1].external = { treeId: "other" };
    expect(validateTree(doc).ok).toBe(true);
    doc.relations[doc.relations.length - 1].from = "ghost2";
    expect(codes(doc)).toContain("missing-endpoint");
  });

  it("前提の循環は警告、関連の循環は問題にしない", () => {
    const doc = base();
    doc.relations.push({ id: "rr", type: "related", from: "integral", to: "limits" });
    expect(validateTree(doc).issues).toEqual([]);
    doc.relations.push({ id: "rp", type: "prerequisite", from: "integral", to: "limits" });
    const r = validateTree(doc);
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.code)).toEqual(["prerequisite-cycle"]);
  });

  it("空の分野と、説明のない未完成ノードを受け入れる", () => {
    const doc = base();
    doc.nodes.push({ id: "empty", kind: "group", parentId: null, title: "空の分野" });
    doc.nodes.push({ id: "todo", kind: "skill", parentId: "empty", title: "あとで書く" });
    expect(validateTree(doc).ok).toBe(true);
  });
});
