import { useEffect, useMemo, useState } from "react";
import type { RelationType, SkillNode, TreeDoc } from "../model/schema";
import { ancestorsOf, subtreeIds, type TreeIndex } from "../model/tree";
import { addRelation, removeNode, removeRelation, setParent, updateNode } from "../model/ops";
import { NodePicker } from "./NodePicker";

interface Props {
  ix: TreeIndex;
  node: SkillNode;
  update(fn: (doc: TreeDoc) => TreeDoc): void;
  notify(message: string): void;
}

type Direction = "before" | "after" | "related";

/** 選択ノードの編集。座標や描画の設定は扱わない */
export function NodeEditor({ ix, node, update, notify }: Props) {
  const [title, setTitle] = useState(node.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [direction, setDirection] = useState<Direction>("after");
  useEffect(() => {
    setTitle(node.title);
    setConfirmDelete(false);
  }, [node.id, node.title]);

  const inside = useMemo(() => subtreeIds(ix, node.id), [ix, node.id]);
  const groups = ix.doc.nodes.filter((n) => n.kind === "group" && !inside.has(n.id));
  const childCount = ix.children.get(node.id)?.length ?? 0;
  const rels = ix.doc.relations.filter((r) => r.from === node.id || r.to === node.id);
  const removedRelations = ix.doc.relations.filter(
    (r) => inside.has(r.from) || inside.has(r.to),
  ).length;

  const commitTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(node.title);
    if (t !== node.title) update((d) => updateNode(d, node.id, { title: t }));
  };

  const addRel = (otherId: string) => {
    const [type, from, to]: [RelationType, string, string] =
      direction === "before"
        ? ["prerequisite", otherId, node.id]
        : direction === "after"
          ? ["prerequisite", node.id, otherId]
          : ["related", node.id, otherId];
    let error: string | null = null;
    update((d) => {
      const r = addRelation(d, type, from, to);
      if (typeof r === "string") {
        error = r;
        return d;
      }
      return r.doc;
    });
    if (error) notify(error);
  };

  const label = (id: string) => {
    const n = ix.byId.get(id);
    if (!n) return id;
    const path = ancestorsOf(ix, id)
      .map((a) => a.title)
      .join(" › ");
    return path ? `${n.title}（${path}）` : n.title;
  };

  return (
    <section className="editor" aria-label="編集">
      <h3>編集</h3>
      <label className="field">
        <span>名前</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          data-testid="edit-title"
        />
      </label>
      <label className="field">
        <span>種類</span>
        <select
          value={node.kind}
          onChange={(e) =>
            update((d) => updateNode(d, node.id, { kind: e.target.value as SkillNode["kind"] }))
          }
          disabled={node.kind === "group" && childCount > 0}
          title={
            node.kind === "group" && childCount > 0
              ? "中身のある分野はスキルにできません"
              : undefined
          }
        >
          <option value="skill">スキル</option>
          <option value="group">分野（中にグラフを持つ）</option>
        </select>
      </label>
      <label className="field">
        <span>説明</span>
        <textarea
          value={node.summary ?? ""}
          rows={3}
          onChange={(e) =>
            update((d) => updateNode(d, node.id, { summary: e.target.value || undefined }))
          }
        />
      </label>
      <label className="field">
        <span>できるようになること</span>
        <textarea
          value={node.unlocks ?? ""}
          rows={3}
          onChange={(e) =>
            update((d) => updateNode(d, node.id, { unlocks: e.target.value || undefined }))
          }
        />
      </label>
      <label className="field">
        <span>親（どの分野の中に置くか）</span>
        <select
          value={node.parentId ?? ""}
          onChange={(e) => {
            let error: string | null = null;
            update((d) => {
              const r = setParent(d, node.id, e.target.value || null);
              if (typeof r === "string") {
                error = r;
                return d;
              }
              return r;
            });
            if (error) notify(error);
          }}
        >
          <option value="">最上位</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {label(g.id)}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>関係</span>
        {rels.length === 0 && <div className="muted">まだありません</div>}
        <ul className="rel-list">
          {rels.map((r) => {
            const other = r.from === node.id ? r.to : r.from;
            const text = r.type === "related" ? "関連" : r.from === node.id ? "次へ →" : "← 前提";
            return (
              <li key={r.id}>
                <span className={`rel-type rel-${r.type}`}>{text}</span>
                <span className="rel-other">{label(other)}</span>
                <button
                  className="icon"
                  aria-label="この関係を削除"
                  onClick={() => update((d) => removeRelation(d, r.id))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <div className="rel-add">
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            aria-label="関係の種類"
          >
            <option value="after">この先につながる（前提として）</option>
            <option value="before">先にあると良い（前提にする）</option>
            <option value="related">関連</option>
          </select>
          <NodePicker
            ix={ix}
            exclude={new Set([node.id])}
            onPick={addRel}
            placeholder="つなぐ相手を名前で探す"
          />
        </div>
      </div>

      <div className="danger">
        {confirmDelete ? (
          <>
            <p>
              「{node.title}」{inside.size > 1 ? `と内部の ${inside.size - 1} 項目` : ""}、関係{" "}
              {removedRelations} 本を削除します。
            </p>
            <button className="danger-button" onClick={() => update((d) => removeNode(d, node.id))}>
              削除する
            </button>
            <button onClick={() => setConfirmDelete(false)}>やめる</button>
          </>
        ) : (
          <button className="danger-link" onClick={() => setConfirmDelete(true)}>
            このノードを削除…
          </button>
        )}
      </div>
    </section>
  );
}
