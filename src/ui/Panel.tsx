import type { ReactNode } from "react";
import type { SkillNode } from "../model/schema";
import { ancestorsOf, subtreeIds, type TreeIndex } from "../model/tree";
import { relationsAround, type RelationAround } from "../viewgraph/viewgraph";
import type { Place } from "../camera/navigation";

interface Props {
  ix: TreeIndex;
  place: Place;
  onGoTo(id: string): void;
  onEnter(id: string): void;
  children?: ReactNode;
}

export function Panel({ ix, place, onGoTo, onEnter, children }: Props) {
  const node = place.selectedId ? ix.byId.get(place.selectedId) : undefined;
  const level = place.levelId ? ix.byId.get(place.levelId) : undefined;
  return (
    <div className="panel-body">
      {node ? (
        <NodeInfo ix={ix} node={node} place={place} onGoTo={onGoTo} onEnter={onEnter} />
      ) : level ? (
        <LevelInfo ix={ix} node={level} />
      ) : (
        <RootInfo ix={ix} />
      )}
      {children}
    </div>
  );
}

function PathLine({ ix, id }: { ix: TreeIndex; id: string }) {
  const path = ancestorsOf(ix, id).map((n) => n.title);
  return <div className="panel-path">{path.length ? path.join(" › ") : "最上位"}</div>;
}

function NodeInfo({
  ix,
  node,
  place,
  onGoTo,
  onEnter,
}: {
  ix: TreeIndex;
  node: SkillNode;
  place: Place;
  onGoTo(id: string): void;
  onEnter(id: string): void;
}) {
  const childCount = ix.children.get(node.id)?.length ?? 0;
  const rels = relationsAround(ix, node.id).filter((r) => !r.inner);
  const before = rels.filter((r) => r.relation.type === "prerequisite" && r.direction === "in");
  const after = rels.filter((r) => r.relation.type === "prerequisite" && r.direction === "out");
  const related = rels.filter((r) => r.relation.type === "related");
  const inside = node.kind === "group" ? subtreeIds(ix, node.id) : new Set([node.id]);
  const achievements = ix.doc.achievements.filter((a) => a.skillIds.some((s) => inside.has(s)));

  return (
    <article className="node-info" key={node.id}>
      <div className="panel-meta">
        <span className={`kind-badge kind-${node.kind}`}>
          {node.kind === "group" ? "分野" : "スキル"}
        </span>
        <PathLine ix={ix} id={node.id} />
      </div>
      <h2 className="panel-title">{node.title}</h2>
      {node.summary ? (
        <p className="panel-summary">{node.summary}</p>
      ) : (
        <p className="panel-empty">説明はまだありません。</p>
      )}
      {node.unlocks && (
        <section className="unlocks">
          <h3>できるようになること</h3>
          <p>{node.unlocks}</p>
        </section>
      )}
      {node.kind === "group" && (
        <button
          className="enter-button"
          onClick={() => onEnter(node.id)}
          data-testid="enter-button"
        >
          <span>中へ入る</span>
          <small>{childCount ? `${childCount} 項目` : "まだ空です"} · Enter</small>
        </button>
      )}
      <Connections
        title="先にあると良いもの"
        items={before}
        ix={ix}
        node={node}
        place={place}
        onGoTo={onGoTo}
      />
      <Connections
        title="この先につながるもの"
        items={after}
        ix={ix}
        node={node}
        place={place}
        onGoTo={onGoTo}
      />
      <Connections title="関連" items={related} ix={ix} node={node} place={place} onGoTo={onGoTo} />
      {achievements.length > 0 && (
        <section className="achievements">
          <h3>実績</h3>
          <ul>
            {achievements.map((a) => (
              <li key={a.id}>
                <div className="achievement-title">{a.title}</div>
                <div className="achievement-cond">{a.condition.text}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function Connections({
  title,
  items,
  ix,
  node,
  place,
  onGoTo,
}: {
  title: string;
  items: RelationAround[];
  ix: TreeIndex;
  node: SkillNode;
  place: Place;
  onGoTo(id: string): void;
}) {
  if (!items.length) return null;
  return (
    <section className="connections">
      <h3>
        {title} <span className="count">{items.length}</span>
      </h3>
      <ul>
        {items.map((r) => {
          const own = r.direction === "out" ? r.relation.from : r.relation.to;
          const via = own !== node.id ? ix.byId.get(own)?.title : null;
          const elsewhere = r.other ? r.other.parentId !== place.levelId : true;
          return (
            <li key={r.relation.id}>
              <button
                className="conn"
                disabled={!r.other}
                onClick={() => onGoTo(r.otherId)}
                data-testid={`conn-${r.otherId}`}
              >
                <span className="conn-title">
                  {r.other?.title ?? r.relation.external?.title ?? r.otherId}
                  {elsewhere && <span className="elsewhere">別の枝</span>}
                </span>
                <span className="conn-path">
                  {r.otherPath.length ? r.otherPath.join(" › ") : "最上位"}
                </span>
                {via && <span className="conn-via">内部の「{via}」から</span>}
                {r.relation.note && <span className="conn-note">{r.relation.note}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LevelInfo({ ix, node }: { ix: TreeIndex; node: SkillNode }) {
  const count = ix.children.get(node.id)?.length ?? 0;
  return (
    <article className="node-info">
      <div className="panel-meta">
        <span className="kind-badge kind-group">いまいる分野</span>
        <PathLine ix={ix} id={node.id} />
      </div>
      <h2 className="panel-title">{node.title}</h2>
      {node.summary && <p className="panel-summary">{node.summary}</p>}
      {node.unlocks && (
        <section className="unlocks">
          <h3>できるようになること</h3>
          <p>{node.unlocks}</p>
        </section>
      )}
      <p className="panel-hint">
        {count
          ? "ノードを選ぶと、その説明とつながりが出ます。"
          : "この分野にはまだ何もありません。"}
      </p>
    </article>
  );
}

function RootInfo({ ix }: { ix: TreeIndex }) {
  return (
    <article className="node-info">
      <div className="panel-meta">
        <span className="kind-badge kind-group">ツリー</span>
      </div>
      <h2 className="panel-title">{ix.doc.title}</h2>
      {ix.doc.description && <p className="panel-summary">{ix.doc.description}</p>}
      <ul className="howto">
        <li>ノードをクリックすると、そこへ視点が移ります。</li>
        <li>輪のある球は分野です。もう一度クリックするか、ダブルクリックで中へ入れます。</li>
        <li>戻るは Esc。上部の現在地から、上の階層へも移れます。</li>
        <li>ドラッグで移動、ホイールで拡大・縮小。</li>
      </ul>
    </article>
  );
}
