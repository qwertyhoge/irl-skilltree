import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { click, open, settle, state } from "./helpers";

test("ツリー全体を書き出し、開き直すと同じ内容になる", async ({ page }) => {
  await open(page);
  // 少し編集してから書き出す
  await click(page, "ml");
  await settle(page);
  await page.getByTestId("toggle-edit").click();
  await page.getByTestId("edit-title").fill("機械学習（改）");
  await page.getByTestId("edit-title").press("Enter");
  await expect(page.getByTestId("save-state")).toHaveText("書き出していない変更あり");

  await page.getByTestId("open-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-confirm").click(),
  ]);
  const path = await download.path();
  const exported = JSON.parse(await readFile(path!, "utf8"));
  expect(exported.nodes.find((n: { id: string }) => n.id === "ml").title).toBe("機械学習（改）");
  await expect(page.getByTestId("save-state")).toHaveText("保存済み");

  // 別のページで開き直す
  const fresh = await page.context().newPage();
  await open(fresh);
  await fresh.getByRole("button", { name: "開く" }).click();
  await fresh.getByTestId("file-input").setInputFiles(path!);
  await fresh.getByTestId("open-confirm").click();
  await settle(fresh);
  const reopened = await fresh.evaluate(
    () => JSON.parse(localStorage.getItem("irl-skilltree:v1:working")!).doc,
  );
  expect(reopened).toEqual(exported);
  await expect(fresh.locator(".node-label-title", { hasText: "機械学習（改）" })).toBeVisible();
});

test("枝だけを書き出すとき、範囲外の関係の扱いを選べる", async ({ page }) => {
  await open(page);
  await click(page, "math");
  await settle(page);
  await page.getByTestId("open-export").click();
  await page.getByTestId("export-branch").check();
  await expect(page.getByRole("dialog")).toContainText("枝の外とつながる関係が");
  await page.getByTestId("export-drop").check();
  await expect(page.getByRole("dialog").locator(".report-detail li").first()).toContainText("削除");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-confirm").click(),
  ]);
  const doc = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(doc.nodes.some((n: { id: string }) => n.id === "gd")).toBe(false);
  expect(doc.relations.some((r: { id: string }) => r.id === "r-grad-gd")).toBe(false);
});

test("別のツリーの枝を取り込むと ID の衝突を解決し、報告する", async ({ page }) => {
  await open(page);
  await click(page, "prog");
  await settle(page);
  await page.getByTestId("open-import").click();
  await page.getByRole("button", { name: "同梱サンプルを使う" }).click();
  await page.getByRole("radio", { name: /線形代数/ }).check();
  await page.getByTestId("import-parent").selectOption({ label: "プログラミング" });
  await page.getByTestId("import-confirm").click();
  await expect(page.getByRole("dialog")).toContainText("ID を付け替えました");
  await expect(page.getByRole("dialog")).toContainText("取り込んでいません");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .last()
    .click();
  await settle(page);
  const s = await state(page);
  expect(s.intent).toEqual({ levelId: "prog", selectedId: "linalg-2" });
  await expect(page.locator(".panel-path")).toContainText("プログラミング");
});

test("編集: 追加・関係づけ・削除が座標なしでできる", async ({ page }) => {
  await open(page);
  await page.getByTestId("toggle-edit").click();
  await click(page, "prog");
  await settle(page);
  await page.getByTestId("enter-button").click();
  await settle(page);
  await page.getByTestId("add-skill").click();
  await settle(page);
  await page.getByTestId("edit-title").fill("データ可視化");
  await page.getByTestId("edit-title").press("Enter");
  await page.getByPlaceholder("つなぐ相手を名前で探す").fill("主成分");
  await page.getByRole("button", { name: /主成分分析/ }).click();
  await expect(page.locator(".rel-list")).toContainText("主成分分析");
  await settle(page);
  await expect(page.locator(".node-label-title", { hasText: "データ可視化" })).toBeVisible();
  // 階層をまたぐ関係なので、ポータルとして見える
  expect((await state(page)).portals).toContain("pca");

  await page.getByRole("button", { name: "このノードを削除…" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await settle(page);
  await expect(page.locator(".node-label-title", { hasText: "データ可視化" })).toHaveCount(0);
});
