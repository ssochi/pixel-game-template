# CLAUDE.md

## 协作分工

- **Fable 5**：负责规划、任务拆分、质检与最终验收。不直接大规模写代码；产出任务书、审阅 diff、跑视觉验收（Playwright 截图 + 8x proof 页）、把关提交。
- **Claude 5（Opus 5 / Sonnet 5 子代理）**：负责具体执行。每个任务书限定文件范围、给出缺陷定位与验收标准，执行完必须通过 `npx tsc --noEmit`。

## 项目事实（执行任务前必读）

- Vite + TypeScript + Canvas 2D。内部分辨率 **448x252**，整数倍放大。**所有美术都是启动时程序化生成**（`src/art/`），仓库里没有图片文件。
- 调色板纪律：颜色只能来自 `src/art/palette.ts` 的色阶（ramp）。`bakeSheet` 会对每帧执行 `quantize()`。加深/提亮要沿本色阶走（`shade`/`rampPick`），不要向黑白渐变。
- 精灵管线：`PixelBuffer`（整数绘图原语）→ `bakeSheet(frames, ax, ay)` → `Sheet`（锚点 = 脚底/中心）→ `clip()`。`drawFrame(ctx, sheet, i, x, y)` 会把**锚点**放在 (x,y)。
- 美术规范 15 条写在 README「美术风格规则」一节，改画之前先读。核心：手指数目级的小物件必须手工点（`parseArt`），簇状纹理而非均匀噪声，选择性描边（`selOutline`），像素圆用中心采样。
- 世界：`src/game/terrain.ts`（1440x960，河流 SDF、道路、田地）、`scene.ts`（摆放建筑/装饰/NPC 出生点）、`interior.ts`（懒加载房间）。渲染顺序：烘焙地面 → 河流 → ground 层贴花 → 农田 → y 排序世界 → 粒子 → 光照 → HUD。
- 测试：dev 模式暴露 `window.game`（`warp/setTime/enter/leave/state/farm/inv/useTool/fishing`）。视觉验收用 Playwright + `/opt/pw-browsers/chromium`，8x 放大页在 `/proof.html?g=hero|items|props|town|animals|fish`。
- 验证命令：`npx tsc --noEmit`（必过）、`npx vite build`（提交前过一次）。

## 执行任务的边界

- 只改任务书列出的文件；发现相邻问题记录在结果里，不要顺手改。
- 不新增依赖、不加图片资源、不改内部分辨率。
- 提交由验收方（Fable 5）统一执行，执行代理不 commit/push。
