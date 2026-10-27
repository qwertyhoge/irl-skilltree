import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import sample from "../../samples/math.v1.json";
import type { TreeDoc } from "../model/schema";
import { ancestorsOf, indexTree } from "../model/tree";
import { addNode } from "../model/ops";
import * as nav from "../camera/navigation";
import { SkillScene } from "../scene/SkillScene";
import { loadWorking, saveWorking, type Working } from "../persistence/storage";
import { Panel } from "./Panel";
import { NodeEditor } from "./NodeEditor";
import { ExportDialog, ImportDialog, OpenDialog } from "./dialogs";
import { TuningPanel } from "./TuningPanel";

const NARROW = 760;
const showTuning = new URLSearchParams(location.search).has("tune");

/** 描画に影響する部分だけのキー。説明文の編集ではシーンを作り直さない */
function structuralKey(doc: TreeDoc): string {
  return JSON.stringify([
    doc.nodes.map((n) => [n.id, n.kind, n.parentId, n.title]),
    doc.relations.map((r) => [r.id, r.type, r.from, r.to]),
  ]);
}

export function App() {
  const [working, setWorking] = useState<Working>(
    () => loadWorking() ?? { doc: sample as TreeDoc, dirty: false },
  );
  const workingRef = useRef(working);
  workingRef.current = working;
  const doc = working.doc;
  const ix = useMemo(() => indexTree(doc), [doc]);
  const ixRef = useRef(ix);
  ixRef.current = ix;

  const [navState, setNav] = useState(nav.initialNav);
  const [editMode, setEditMode] = useState(false);
  const [dialog, setDialog] = useState<null | "open" | "import" | "export">(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [saved, setSaved] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<SkillScene | null>(null);

  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  /** ツリーの編集。現在の値に同期的に適用する（操作の失敗を呼び出し側が受け取れる） */
  const update = useCallback((fn: (d: TreeDoc) => TreeDoc) => {
    const next = fn(workingRef.current.doc);
    if (next === workingRef.current.doc) return;
    workingRef.current = { doc: next, dirty: true };
    setWorking(workingRef.current);
  }, []);

  const replaceDoc = useCallback((d: TreeDoc) => {
    workingRef.current = { doc: d, dirty: false };
    setWorking(workingRef.current);
    setNav(nav.initialNav());
  }, []);

  // ブラウザへの自動保存
  useEffect(() => setSaved(saveWorking(working)), [working]);
  useEffect(() => {
    if (saved || !working.dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [saved, working.dirty]);

  // ---------------------------------------------------------------- 移動
  const view = () => sceneRef.current?.currentView();
  const doSelect = useCallback((id: string | null) => setNav((s) => nav.select(s, id)), []);
  const doEnter = useCallback((id: string) => {
    if (ixRef.current.byId.get(id)?.kind !== "group") return;
    const v = view();
    setNav((s) => nav.enter(s, id, v));
  }, []);
  const doGoTo = useCallback((id: string) => {
    const v = view();
    setNav((s) => nav.goTo(ixRef.current, s, id, v));
  }, []);
  const doUp = useCallback((levelId: string | null) => {
    const v = view();
    setNav((s) => nav.up(ixRef.current, s, levelId, v));
  }, []);
  const doBack = useCallback(() => setNav((s) => nav.back(s)), []);

  // ---------------------------------------------------------------- シーン
  useEffect(() => {
    const scene = new SkillScene(stageRef.current!, {
      select: doSelect,
      enter: doEnter,
      portal: doGoTo,
    });
    sceneRef.current = scene;
    (window as unknown as { __skillScene: SkillScene }).__skillScene = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [doSelect, doEnter, doGoTo]);

  const sceneKey = useMemo(() => structuralKey(doc), [doc]);
  useEffect(() => {
    void sceneRef.current?.setTree(ixRef.current);
  }, [sceneKey]);

  useEffect(() => setNav((s) => nav.reconcile(ix, s)), [ix]);
  useEffect(() => sceneRef.current?.setIntent(navState.place), [navState.place]);

  // パネルが覆う領域をシーンに伝える
  useEffect(() => {
    const el = panelRef.current;
    const report = () => {
      const narrow = innerWidth < NARROW;
      const r = el?.getBoundingClientRect();
      const right = !narrow && panelOpen && r ? innerWidth - r.left : 0;
      const bottom = narrow && panelOpen && r ? innerHeight - r.top : 0;
      sceneRef.current?.setInsets(Math.round(right), Math.round(bottom));
    };
    report();
    const ro = new ResizeObserver(report);
    if (el) ro.observe(el);
    addEventListener("resize", report);
    return () => {
      ro.disconnect();
      removeEventListener("resize", report);
    };
  }, [panelOpen]);

  // キーボード
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (dialog || t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape" || e.key === "Backspace") {
        e.preventDefault();
        doBack();
      } else if (e.key === "Enter" && navState.place.selectedId) {
        const target = t.closest("button");
        if (target) return;
        doEnter(navState.place.selectedId);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [dialog, doBack, doEnter, navState.place.selectedId]);

  // ---------------------------------------------------------------- 編集
  const addHere = (kind: "skill" | "group") => {
    const levelId = navState.place.levelId;
    let id = "";
    update((d) => {
      const r = addNode(d, {
        kind,
        parentId: levelId,
        title: kind === "group" ? "新しい分野" : "新しいスキル",
        id: kind === "group" ? "group" : "skill",
      });
      id = r.id;
      return r.doc;
    });
    if (id) setNav((s) => nav.select(s, id));
  };

  const place = navState.place;
  const selected = place.selectedId ? ix.byId.get(place.selectedId) : undefined;
  const crumbs = place.levelId
    ? [...ancestorsOf(ix, place.levelId), ix.byId.get(place.levelId)!]
    : [];
  const levelEmpty = (ix.children.get(place.levelId)?.length ?? 0) === 0;

  return (
    <div className={`app ${editMode ? "is-editing" : ""}`}>
      <div className="stage" ref={stageRef} data-testid="stage" />

      <header className="topbar">
        <button
          className="back"
          onClick={doBack}
          disabled={navState.history.length === 0}
          title="戻る（Esc）"
          data-testid="back"
        >
          ← 戻る
        </button>
        <nav className="crumbs" aria-label="現在地">
          <button
            onClick={() => doUp(null)}
            className={place.levelId === null ? "current" : ""}
            data-testid="crumb-root"
          >
            {doc.title}
          </button>
          {crumbs.map((c) => (
            <span key={c.id}>
              <span className="sep">›</span>
              <button
                onClick={() => doUp(c.id)}
                className={c.id === place.levelId ? "current" : ""}
                data-testid={`crumb-${c.id}`}
              >
                {c.title}
              </button>
            </span>
          ))}
        </nav>
        <div className="tools">
          <span
            className={`save-state ${!saved ? "is-error" : working.dirty ? "is-dirty" : ""}`}
            data-testid="save-state"
          >
            {!saved
              ? "ブラウザに保存できません"
              : working.dirty
                ? "書き出していない変更あり"
                : "保存済み"}
          </span>
          <button
            onClick={() => setEditMode((v) => !v)}
            className={editMode ? "active" : ""}
            data-testid="toggle-edit"
          >
            {editMode ? "編集を終える" : "編集"}
          </button>
          <button onClick={() => setDialog("open")}>開く</button>
          <button onClick={() => setDialog("import")} data-testid="open-import">
            取り込む
          </button>
          <button onClick={() => setDialog("export")} data-testid="open-export">
            書き出す
          </button>
        </div>
      </header>

      {levelEmpty && (
        <div className="empty-level">
          <p>この分野にはまだ何もありません。</p>
          {editMode ? (
            <p>右の「この階層に追加」から作れます。</p>
          ) : (
            <p>「編集」から中身を追加できます。</p>
          )}
        </div>
      )}

      <aside
        className={`panel ${panelOpen ? "" : "is-collapsed"}`}
        ref={panelRef}
        data-testid="panel"
      >
        <button
          className="panel-toggle"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label={panelOpen ? "説明を閉じる" : "説明を開く"}
        >
          {panelOpen ? "›" : "‹"}
        </button>
        {panelOpen && (
          <Panel ix={ix} place={place} onGoTo={doGoTo} onEnter={doEnter}>
            {editMode && (
              <>
                {selected && (
                  <NodeEditor
                    key={selected.id}
                    ix={ix}
                    node={selected}
                    update={update}
                    notify={notify}
                  />
                )}
                <section className="editor add-here">
                  <h3>この階層に追加</h3>
                  <div className="row">
                    <button onClick={() => addHere("skill")} data-testid="add-skill">
                      ＋ スキル
                    </button>
                    <button onClick={() => addHere("group")}>＋ 分野</button>
                  </div>
                </section>
              </>
            )}
          </Panel>
        )}
      </aside>

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      {dialog === "open" && (
        <OpenDialog
          dirty={working.dirty}
          onClose={() => setDialog(null)}
          onOpen={(d) => {
            replaceDoc(d);
            setDialog(null);
          }}
        />
      )}
      {dialog === "import" && (
        <ImportDialog
          ix={ix}
          defaultParent={place.levelId}
          onClose={() => setDialog(null)}
          onImport={(d, _report, roots) => {
            update(() => d);
            if (roots.length === 1) {
              const v = view();
              setNav((s) => nav.goTo(indexTree(d), s, roots[0], v));
            }
          }}
        />
      )}
      {dialog === "export" && (
        <ExportDialog
          ix={ix}
          selectedId={place.selectedId}
          onClose={() => setDialog(null)}
          onExportedAll={() => {
            workingRef.current = { ...workingRef.current, dirty: false };
            setWorking(workingRef.current);
          }}
        />
      )}
      {showTuning && <TuningPanel />}
    </div>
  );
}
