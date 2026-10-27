import { useMemo, useState, type ReactNode } from "react";
import type { Relation, TreeDoc } from "../model/schema";
import { indexTree, ancestorsOf, type TreeIndex } from "../model/tree";
import type { Issue } from "../model/validate";
import {
  extractBranch,
  importBranch,
  type ImportReport,
  type OutsideLinkMode,
} from "../model/exchange";
import { downloadTree, readTreeFile } from "../persistence/files";
import sample from "../../samples/math.v1.json";

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

function Issues({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="issues">
      {issues.map((i, n) => (
        <li key={n} className={`issue-${i.level}`}>
          {i.level === "error" ? "エラー" : "注意"}: {i.message}
        </li>
      ))}
    </ul>
  );
}

/** ファイルを選んで検証する。成功したらツリーを返す */
function useTreeFile() {
  const [state, setState] = useState<{ doc: TreeDoc | null; issues: Issue[]; name: string }>({
    doc: null,
    issues: [],
    name: "",
  });
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const r = await readTreeFile(file);
    setState({ doc: r.ok ? r.doc : null, issues: r.issues, name: file.name });
  };
  const useSample = () => setState({ doc: sample as TreeDoc, issues: [], name: "同梱サンプル" });
  return { ...state, pick, useSample };
}

function FileChooser({ file }: { file: ReturnType<typeof useTreeFile> }) {
  return (
    <div className="file-chooser">
      <input
        type="file"
        accept=".json,application/json"
        onChange={(e) => void file.pick(e.target.files?.[0])}
        data-testid="file-input"
      />
      <button className="link" onClick={file.useSample}>
        同梱サンプルを使う
      </button>
      {file.name && <div className="muted">選択中: {file.name}</div>}
      <Issues issues={file.issues} />
    </div>
  );
}

const relLabel = (ix: TreeIndex, r: Relation) => {
  const t = (id: string) => ix.byId.get(id)?.title ?? r.external?.title ?? id;
  return `${t(r.from)} ${r.type === "prerequisite" ? "→" : "↔"} ${t(r.to)}`;
};

// ------------------------------------------------------------------ 開く

export function OpenDialog({
  dirty,
  onOpen,
  onClose,
}: {
  dirty: boolean;
  onOpen(doc: TreeDoc): void;
  onClose(): void;
}) {
  const file = useTreeFile();
  return (
    <Dialog title="ツリーを開く" onClose={onClose}>
      <p>今のツリーを、選んだファイルの内容に置き換えます。</p>
      {dirty && (
        <p className="warn">書き出していない変更があります。必要なら先に書き出してください。</p>
      )}
      <FileChooser file={file} />
      <footer>
        <button onClick={onClose}>やめる</button>
        <button
          className="primary"
          disabled={!file.doc}
          onClick={() => file.doc && onOpen(file.doc)}
          data-testid="open-confirm"
        >
          開く
        </button>
      </footer>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 取り込み

interface ImportProps {
  ix: TreeIndex;
  defaultParent: string | null;
  onImport(doc: TreeDoc, report: ImportReport, rootIds: string[]): void;
  onClose(): void;
}

export function ImportDialog({ ix, defaultParent, onImport, onClose }: ImportProps) {
  const file = useTreeFile();
  const [branch, setBranch] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(defaultParent);
  const [result, setResult] = useState<{ report: ImportReport; source: TreeIndex } | null>(null);
  const six = useMemo(() => (file.doc ? indexTree(file.doc) : null), [file.doc]);
  const groups = ix.doc.nodes.filter((n) => n.kind === "group");

  const run = () => {
    if (!file.doc || !six) return;
    const { doc, report } = importBranch(ix.doc, file.doc, branch, parent);
    const roots = (branch === null ? (six.children.get(null) ?? []) : [branch]).map((id) =>
      report.idMap.get(id)!,
    );
    setResult({ report, source: six });
    onImport(doc, report, roots);
  };

  if (result) {
    const { report, source } = result;
    return (
      <Dialog title="取り込みました" onClose={onClose}>
        <ul className="report">
          <li>
            ノード {[...report.idMap.keys()].filter((id) => source.byId.has(id)).length}{" "}
            件をコピーしました。各ノードに取り込み元を記録しています。
          </li>
          {report.renamed.length > 0 && (
            <li>
              ID が重なったため {report.renamed.length} 件の ID を付け替えました（例:{" "}
              {report.renamed
                .slice(0, 3)
                .map((r) => `${r.from} → ${r.to}`)
                .join("、")}
              ）。
            </li>
          )}
          {report.reconnectedRelations.length > 0 && (
            <li>
              以前に取り込んだノードへの関係 {report.reconnectedRelations.length}{" "}
              本をつなぎ直しました。
            </li>
          )}
          {report.skippedRelations.length > 0 && (
            <li>
              相手が取り込み範囲の外にあるため、次の関係 {report.skippedRelations.length}{" "}
              本は取り込んでいません:
              <ul className="report-detail">
                {report.skippedRelations.map((r) => (
                  <li key={r.id}>{relLabel(source, r)}</li>
                ))}
              </ul>
            </li>
          )}
        </ul>
        <footer>
          <button className="primary" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </Dialog>
    );
  }

  return (
    <Dialog title="別のツリーから取り込む" onClose={onClose}>
      <p>選んだ枝を、今のツリーにコピーします。元のファイルは変わりません。</p>
      <FileChooser file={file} />
      {six && (
        <>
          <h3>取り込む枝</h3>
          <div className="branch-list" role="radiogroup">
            <label>
              <input type="radio" checked={branch === null} onChange={() => setBranch(null)} />{" "}
              全体（{six.doc.nodes.length} ノード）
            </label>
            {six.doc.nodes.map((n) => (
              <label key={n.id} style={{ paddingLeft: 12 + ancestorsOf(six, n.id).length * 16 }}>
                <input type="radio" checked={branch === n.id} onChange={() => setBranch(n.id)} />{" "}
                {n.title}
                <span className="muted"> {n.kind === "group" ? "分野" : "スキル"}</span>
              </label>
            ))}
          </div>
          <label className="field">
            <span>取り込み先</span>
            <select
              value={parent ?? ""}
              onChange={(e) => setParent(e.target.value || null)}
              data-testid="import-parent"
            >
              <option value="">最上位</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {[...ancestorsOf(ix, g.id).map((a) => a.title), g.title].join(" › ")}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <footer>
        <button onClick={onClose}>やめる</button>
        <button className="primary" disabled={!file.doc} onClick={run} data-testid="import-confirm">
          取り込む
        </button>
      </footer>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 書き出し

interface ExportProps {
  ix: TreeIndex;
  selectedId: string | null;
  onExportedAll(): void;
  onClose(): void;
}

export function ExportDialog({ ix, selectedId, onExportedAll, onClose }: ExportProps) {
  const [scope, setScope] = useState<"all" | "branch">("all");
  const [mode, setMode] = useState<OutsideLinkMode>("keep-external");
  const selected = selectedId ? ix.byId.get(selectedId) : undefined;
  const preview = useMemo(
    () => (scope === "branch" && selectedId ? extractBranch(ix.doc, selectedId, mode) : null),
    [scope, selectedId, mode, ix.doc],
  );
  const outside = preview ? [...preview.report.dropped, ...preview.report.keptAsExternal] : [];

  const run = () => {
    if (preview) downloadTree(preview.doc);
    else {
      downloadTree(ix.doc);
      onExportedAll();
    }
    onClose();
  };

  return (
    <Dialog title="書き出す" onClose={onClose}>
      <p>交換用の JSON を保存します。個人の学習記録は含みません。</p>
      <div className="choice">
        <label>
          <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />{" "}
          ツリー全体（{ix.doc.nodes.length} ノード）
        </label>
        <label className={selected ? "" : "disabled"}>
          <input
            type="radio"
            checked={scope === "branch"}
            disabled={!selected}
            onChange={() => setScope("branch")}
            data-testid="export-branch"
          />
          選択中の枝だけ{selected ? `: ${selected.title}` : "（ノードを選ぶと使えます）"}
        </label>
      </div>
      {preview && (
        <>
          <p>
            {preview.doc.nodes.length} ノード、関係 {preview.doc.relations.length} 本。
            {outside.length
              ? `枝の外とつながる関係が ${outside.length} 本あります。`
              : "枝の外とつながる関係はありません。"}
          </p>
          {outside.length > 0 && (
            <>
              <div className="choice">
                <label>
                  <input
                    type="radio"
                    checked={mode === "keep-external"}
                    onChange={() => setMode("keep-external")}
                  />{" "}
                  外部参照として残す（相手の名前と所属を記録）
                </label>
                <label>
                  <input
                    type="radio"
                    checked={mode === "drop"}
                    onChange={() => setMode("drop")}
                    data-testid="export-drop"
                  />{" "}
                  削除する
                </label>
              </div>
              <ul className="report-detail">
                {outside.map((r) => (
                  <li key={r.id}>
                    {relLabel(ix, r)}{" "}
                    <span className="muted">{mode === "drop" ? "削除" : "外部参照"}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview.report.trimmedAchievements.length > 0 && (
            <p className="muted">
              実績 {preview.report.trimmedAchievements.join("、")}{" "}
              は、枝の中のスキルだけに絞ります。
            </p>
          )}
        </>
      )}
      <footer>
        <button onClick={onClose}>やめる</button>
        <button className="primary" onClick={run} data-testid="export-confirm">
          書き出す
        </button>
      </footer>
    </Dialog>
  );
}
