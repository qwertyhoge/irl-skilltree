import type { TreeDoc } from "../model/schema";
import { validateTree, type ValidationResult } from "../model/validate";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function downloadTree(doc: TreeDoc, filename = `${doc.id}.skilltree.json`) {
  const blob = new Blob([JSON.stringify(doc, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ファイルを読み、JSON として解釈して検証する */
export async function readTreeFile(file: File): Promise<ValidationResult> {
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      issues: [
        {
          level: "error",
          code: "schema",
          message: `ファイルが大きすぎます（上限 ${MAX_FILE_BYTES / 1024 / 1024}MB）`,
        },
      ],
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return {
      ok: false,
      issues: [{ level: "error", code: "schema", message: "JSON として読めません" }],
    };
  }
  return validateTree(data);
}
