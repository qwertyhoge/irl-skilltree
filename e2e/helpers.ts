import { expect, type Page } from "@playwright/test";

type SceneState = {
  levelId: string | null;
  transitioning: boolean;
  intent: { levelId: string | null; selectedId: string | null };
  portals: string[];
};

export async function open(page: Page, query = "") {
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`/${query}`);
  await settle(page);
}

export const state = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __skillScene: { state(): SceneState } }).__skillScene.state(),
  );

export async function settle(page: Page) {
  await page.waitForFunction(
    () => {
      const s = (
        window as unknown as { __skillScene?: { state(): SceneState } }
      ).__skillScene?.state();
      return s && !s.transitioning && s.levelId === s.intent.levelId;
    },
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(100);
}

export async function at(page: Page, id: string) {
  const p = await page.evaluate(
    (id) =>
      (
        window as unknown as {
          __skillScene: { screenOf(id: string): { x: number; y: number } | null };
        }
      ).__skillScene.screenOf(id),
    id,
  );
  expect(p, `ノード ${id} が画面にある`).not.toBeNull();
  return p!;
}

export async function click(page: Page, id: string) {
  const p = await at(page, id);
  await page.mouse.click(p.x, p.y);
}

export async function dive(page: Page, id: string) {
  const p = await at(page, id);
  await page.mouse.dblclick(p.x, p.y);
  await settle(page);
}

/** パネルを除いた領域の中心 */
export async function freeCenter(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-testid=panel]")!.getBoundingClientRect();
    return { x: panel.left / 2, y: innerHeight / 2 };
  });
}
