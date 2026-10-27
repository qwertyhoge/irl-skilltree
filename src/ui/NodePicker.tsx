import { useMemo, useState } from "react";
import { ancestorsOf, type TreeIndex } from "../model/tree";

interface Props {
  ix: TreeIndex;
  exclude?: Set<string>;
  onPick(id: string): void;
  placeholder?: string;
}

/** 全階層のノードを名前で探して選ぶ。別の枝への関係づけに使う */
export function NodePicker({ ix, exclude, onPick, placeholder = "名前で探す" }: Props) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return ix.doc.nodes
      .filter((n) => !exclude?.has(n.id) && n.title.toLowerCase().includes(term))
      .slice(0, 8)
      .map((n) => ({
        node: n,
        path:
          ancestorsOf(ix, n.id)
            .map((a) => a.title)
            .join(" › ") || "最上位",
      }));
  }, [q, ix, exclude]);
  return (
    <div className="picker">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {results.length > 0 && (
        <ul className="picker-results">
          {results.map(({ node, path }) => (
            <li key={node.id}>
              <button
                onClick={() => {
                  onPick(node.id);
                  setQ("");
                }}
              >
                <span>{node.title}</span>
                <small>{path}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && results.length === 0 && <div className="picker-none">見つかりません</div>}
    </div>
  );
}
