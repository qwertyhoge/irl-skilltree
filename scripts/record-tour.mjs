// 操作動画を録る（npm run dev を起動した状態で npm run tour）。
// 出力: docs/media/tour.webm（リポジトリには含めない）
import { chromium } from "@playwright/test";
import { mkdir, rename, rm } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:5173";
const outDir = new URL("../docs/media/", import.meta.url).pathname;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=metal"] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 760 },
  recordVideo: { dir: outDir, size: { width: 1280, height: 760 } },
});
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.clear());
await page.goto(base);

const settle = async (pause = 700) => {
  await page.waitForTimeout(50);
  await page.waitForFunction(() => {
    const s = window.__skillScene?.state();
    return s && !s.transitioning && s.levelId === s.intent.levelId;
  });
  await page.waitForTimeout(pause);
};
const at = (id) => page.evaluate((id) => window.__skillScene.screenOf(id), id);
const point = async (id) => {
  const q = await at(id);
  await page.mouse.move(q.x, q.y, { steps: 15 });
  await page.mouse.click(q.x, q.y);
  await settle();
};

await settle(1200);
for (const id of ["math", "analysis", "multivar"]) {
  await point(id); // 選ぶ
  await point(id); // もう一度押して中へ
}
await point("gradient");
await point("gd"); // 別の枝へのポータル
for (let i = 0; i < 5; i++) {
  await page.keyboard.press("Escape");
  await settle();
}

const video = page.video();
await ctx.close();
await browser.close();
const target = `${outDir}tour.webm`;
await rm(target, { force: true });
await rename(await video.path(), target);
console.log(target);
