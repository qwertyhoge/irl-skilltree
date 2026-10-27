import { TreeDocSchema, type TreeDoc } from "./schema";

export interface Issue {
  level: "error" | "warning";
  code:
    | "schema"
    | "duplicate-id"
    | "missing-parent"
    | "parent-not-group"
    | "containment-cycle"
    | "missing-endpoint"
    | "self-relation"
    | "prerequisite-cycle"
    | "missing-skill";
  message: string;
  ids?: string[];
}

export type ValidationResult =
  { ok: true; doc: TreeDoc; issues: Issue[] } | { ok: false; issues: Issue[] };

/** 外部から来た任意の値を検証する。error が一つでもあれば ok: false。 */
export function validateTree(input: unknown): ValidationResult {
  const parsed = TreeDocSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 20).map((i) => ({
        level: "error" as const,
        code: "schema" as const,
        message: `${i.path.join(".") || "(root)"}: ${i.message}`,
      })),
    };
  }
  const doc = parsed.data;
  const issues = checkIntegrity(doc);
  return issues.some((i) => i.level === "error")
    ? { ok: false, issues }
    : { ok: true, doc, issues };
}

/** スキーマを満たすツリーの参照整合性を調べる。 */
export function checkIntegrity(doc: TreeDoc): Issue[] {
  const issues: Issue[] = [];
  const ids = new Map<string, number>();
  for (const x of [...doc.nodes, ...doc.relations, ...doc.achievements]) {
    ids.set(x.id, (ids.get(x.id) ?? 0) + 1);
  }
  for (const [id, n] of ids) {
    if (n > 1)
      issues.push({
        level: "error",
        code: "duplicate-id",
        message: `ID「${id}」が重複しています`,
        ids: [id],
      });
  }

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  for (const n of doc.nodes) {
    if (n.parentId === null) continue;
    const parent = byId.get(n.parentId);
    if (!parent) {
      issues.push({
        level: "error",
        code: "missing-parent",
        message: `「${n.title}」の親「${n.parentId}」がありません`,
        ids: [n.id],
      });
    } else if (parent.kind !== "group") {
      issues.push({
        level: "error",
        code: "parent-not-group",
        message: `「${n.title}」の親「${parent.title}」は分野ではありません`,
        ids: [n.id, parent.id],
      });
    }
  }

  // 包含の循環: 親をたどってルートに着かないもの
  const reported = new Set<string>();
  for (const n of doc.nodes) {
    const seen = new Set<string>();
    let cur: string | null = n.id;
    while (cur !== null && byId.has(cur)) {
      if (seen.has(cur)) {
        const cycle = [...seen].filter((s) => !reported.has(s));
        if (cycle.length) {
          cycle.forEach((s) => reported.add(s));
          issues.push({
            level: "error",
            code: "containment-cycle",
            message: `包含関係が循環しています: ${cycle.map((s) => byId.get(s)!.title).join(" → ")}`,
            ids: cycle,
          });
        }
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)!.parentId;
    }
  }

  for (const r of doc.relations) {
    if (r.from === r.to) {
      issues.push({
        level: "error",
        code: "self-relation",
        message: `関係「${r.id}」が自分自身を指しています`,
        ids: [r.id],
      });
    }
    const missing = [r.from, r.to].filter((end) => !byId.has(end));
    // external 付きの関係は、片方の端点が範囲外にあることを示す参照として残したもの
    if (missing.length > (r.external ? 1 : 0)) {
      issues.push({
        level: "error",
        code: "missing-endpoint",
        message: `関係「${r.id}」の端点「${missing.join("、")}」がありません`,
        ids: [r.id],
      });
    }
  }

  for (const a of doc.achievements) {
    for (const s of a.skillIds) {
      if (!byId.has(s))
        issues.push({
          level: "warning",
          code: "missing-skill",
          message: `実績「${a.title}」の対象「${s}」がありません`,
          ids: [a.id],
        });
    }
  }

  const cycle = findPrerequisiteCycle(doc);
  if (cycle) {
    issues.push({
      level: "warning",
      code: "prerequisite-cycle",
      message: `前提関係が循環しています: ${cycle.map((s) => byId.get(s)?.title ?? s).join(" → ")}`,
      ids: cycle,
    });
  }
  return issues;
}

/** 前提関係（from が to の前提）の循環を一つ返す。関連リンクの循環は対象外。 */
export function findPrerequisiteCycle(doc: TreeDoc): string[] | null {
  const out = new Map<string, string[]>();
  for (const r of doc.relations) {
    if (r.type !== "prerequisite") continue;
    out.set(r.from, [...(out.get(r.from) ?? []), r.to]);
  }
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (v: string): string[] | null => {
    state.set(v, 1);
    stack.push(v);
    for (const w of out.get(v) ?? []) {
      if (state.get(w) === 1) return [...stack.slice(stack.indexOf(w)), w];
      if (!state.has(w)) {
        const found = visit(w);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(v, 2);
    return null;
  };
  for (const v of out.keys()) {
    if (!state.has(v)) {
      const found = visit(v);
      if (found) return found;
    }
  }
  return null;
}
