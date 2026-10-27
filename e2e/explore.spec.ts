import { expect, test } from "@playwright/test";
import { at, click, dive, freeCenter, open, settle, state } from "./helpers";

test("ノードを選ぶと、パネルに隠れない中央へ視点が移り、説明が出る", async ({ page }) => {
  await open(page);
  await click(page, "ml");
  await settle(page);
  const p = await at(page, "ml");
  const c = await freeCenter(page);
  expect(Math.abs(p.x - c.x)).toBeLessThan(40);
  expect(Math.abs(p.y - c.y)).toBeLessThan(60);
  await expect(page.locator(".panel-title")).toHaveText("機械学習");
  await expect(page.locator(".unlocks")).toContainText("データで解ける");
});

test("二階層入って戻ると、選択と視点が元に戻る", async ({ page }) => {
  await open(page);
  await click(page, "math");
  await settle(page);
  const before = await at(page, "math");
  await dive(page, "math");
  expect((await state(page)).levelId).toBe("math");
  await expect(page.getByTestId("crumb-math")).toBeVisible();
  await dive(page, "analysis");
  expect((await state(page)).levelId).toBe("analysis");
  await expect(page.locator(".crumbs")).toContainText("数学›解析学");

  await page.keyboard.press("Escape");
  await settle(page);
  expect((await state(page)).intent).toMatchObject({ levelId: "math", selectedId: "analysis" });
  await page.getByTestId("back").click();
  await settle(page);
  expect((await state(page)).intent).toMatchObject({ levelId: null, selectedId: "math" });
  const after = await at(page, "math");
  // 浮遊のぶんだけずれる
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(16);
  await expect(page.locator(".panel-title")).toHaveText("数学");
});

test("別の枝へのポータルで移動し、戻ると元の場所に帰る", async ({ page }) => {
  await open(page);
  await dive(page, "math");
  await dive(page, "analysis");
  await dive(page, "multivar");
  await click(page, "gradient");
  await settle(page);
  expect((await state(page)).portals.sort()).toEqual(["gd", "vectors"]);
  await expect(page.locator(".node-label.is-portal")).toHaveCount(2);

  await click(page, "gd"); // ポータル（勾配降下法）
  await settle(page);
  expect((await state(page)).intent).toMatchObject({ levelId: "ml", selectedId: "gd" });
  await expect(page.locator(".panel-title")).toHaveText("勾配降下法");
  await expect(page.locator(".crumbs")).toContainText("機械学習");

  await page.keyboard.press("Escape");
  await settle(page);
  expect((await state(page)).intent).toMatchObject({ levelId: "multivar", selectedId: "gradient" });
});

test("パネルのつながりからも別の枝へ移動できる", async ({ page }) => {
  await open(page);
  await click(page, "math");
  await settle(page);
  await page.getByTestId("conn-backprop").click();
  await settle(page);
  expect((await state(page)).intent).toMatchObject({ levelId: "ml", selectedId: "backprop" });
});

test("遷移中の再選択・戻る・連打でも、カメラと説明が同じノードを指す", async ({ page }) => {
  await open(page);
  // 入る途中で戻る
  const m = await at(page, "math");
  await page.mouse.dblclick(m.x, m.y);
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await settle(page);
  let s = await state(page);
  expect(s.levelId).toBe(null);
  expect(s.intent.selectedId).toBe("math");

  // 別の枝への移動の途中で戻る
  await page.getByTestId("conn-gd").click();
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape");
  await settle(page);
  s = await state(page);
  expect(s).toMatchObject({ levelId: null, intent: { levelId: null, selectedId: "math" } });
  await expect(page.locator(".panel-title")).toHaveText("数学");

  // 移動の途中で別のつながりへ行き先を変える
  await page.getByTestId("conn-gd").click();
  await page.waitForTimeout(150);
  await page.getByTestId("crumb-root").click();
  await settle(page);
  s = await state(page);
  expect(s.levelId).toBe(null);
  expect(s.intent.selectedId).toBe("ml");
  await expect(page.locator(".panel-title")).toHaveText("機械学習");

  // 戻る・入るの連打
  await click(page, "math");
  await settle(page);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(60);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
  }
  await settle(page);
  s = await state(page);
  expect(s.levelId).toBe(s.intent.levelId);
  const title = s.intent.selectedId ? await page.locator(".panel-title").textContent() : null;
  if (s.intent.selectedId) {
    const p = await at(page, s.intent.selectedId);
    const c = await freeCenter(page);
    expect(Math.abs(p.x - c.x)).toBeLessThan(40);
    expect(title).toBeTruthy();
  }
});

test("動きを減らす設定でも、入る・戻るが使える", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await dive(page, "math");
  await dive(page, "linalg");
  expect((await state(page)).levelId).toBe("linalg");
  await page.keyboard.press("Escape");
  await settle(page);
  expect((await state(page)).levelId).toBe("math");
});

test("空の分野に入っても壊れない", async ({ page }) => {
  await open(page);
  await dive(page, "math");
  await dive(page, "geometry");
  await expect(page.locator(".empty-level")).toBeVisible();
  await page.keyboard.press("Escape");
  await settle(page);
  expect((await state(page)).intent).toMatchObject({ levelId: "math", selectedId: "geometry" });
});

test("狭い画面では説明が下に出て、選択ノードが隠れない", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await open(page);
  await click(page, "ml");
  await settle(page);
  const p = await at(page, "ml");
  const panelTop = await page.evaluate(
    () => document.querySelector("[data-testid=panel]")!.getBoundingClientRect().top,
  );
  expect(p.y).toBeLessThan(panelTop - 30);
  expect(p.x).toBeGreaterThan(40);
  expect(p.x).toBeLessThan(350);
});
