/**
 * 视觉验收工具 — 把游戏里任意一个角落、任意一个时刻截下来。
 *
 * 像素游戏的问题在代码里看不出来。这个脚本用 dev 模式暴露的 `window.game`
 * 把玩家瞬移到指定坐标、把时间钉在指定时刻、直接跳进某个室内，然后按 4 倍
 * 放大截图——1:1 下看不见的毛刺、断线、平色板，4:1 下一目了然。
 *
 *   npx vite --port 5173 --host 127.0.0.1 &
 *   node docs/qa/shot.mjs '[{"name":"farm","warp":[690,650],"time":0.4}]'
 *
 * 每个条目的字段：
 *   name   输出文件名（写到 docs/qa/shots/<name>.png，该目录不入库）
 *   warp   [x, y] 世界坐标
 *   time   0..1 的一天中的时刻（0.25 早晨，0.5 正午，0.86 入夜）
 *   enter  室内种类：cottage|shop|tavern|inn|smithy|chapel|mill|barn
 *   leave  先退出当前室内（跳到另一个室内时必须带上）
 *   wait   截图前等待的毫秒数，默认 900；室内建议 1400（房间是懒加载烘焙的）
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SHOT_OUT ?? resolve(HERE, 'shots');
const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5173/';
const EXE = process.env.SHOT_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const SHOTS = JSON.parse(process.argv[2] ?? '[]');
if (!SHOTS.length) {
  console.error('usage: node docs/qa/shot.mjs \'[{"name":"farm","warp":[690,650]}]\'');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// 4x 放大需要的视口。Screen.fit() 取 floor(min((w-8)/448, (h-8)/252))。
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1816, height: 1032 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.game, null, { timeout: 30000 });
await page.waitForTimeout(600);
await page.keyboard.press('h'); // 收起调试帮助面板，它盖住三分之一画面
await page.waitForTimeout(200);

for (const s of SHOTS) {
  await page.evaluate((s) => {
    const g = window.game;
    if (s.leave) g.leave();
    if (s.time !== undefined) g.setTime(s.time);
    if (s.warp) g.warp(s.warp[0], s.warp[1]);
    if (s.enter) g.enter(s.enter, s.seed ?? 1);
  }, s);
  await page.waitForTimeout(s.wait ?? (s.enter ? 1400 : 900));
  await page.locator('#screen').screenshot({ path: `${OUT}/${s.name}.png` });
  console.log('shot', s.name);
}

await browser.close();
