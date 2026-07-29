# M02 — 存档

**状态**：待开始
**前置**：M01
**目标**：关掉标签页再打开，能接着上次玩。在这之前，M03 以后每一个里程碑做出来的内容都是留不住的——
这是它排在所有内容之前的唯一理由。

---

## 要存什么

现在的进度散在六个地方（都在 `main.ts` 的 `start()` 闭包里或它持有的对象上）：

| 来源 | 字段 |
| --- | --- |
| `main.ts` 局部 | `day`、`dayT`、`energy` |
| `Farm` (`game/farm.ts`) | `tiles[]` 每格的 `soil` / `watered` / `crop` / `stage` / `progress` |
| `Inventory` (`game/inventory.ts`) | `slots[]`（10 格的 `item` + `count`）、`selected`、`gold` |
| `Social` (`game/social.ts`) | `bonds` Map：每人的 `points` / `lastTalkDay` / `lastGiftDay` / `met` |
| `QUESTS` (`game/social.ts`) | 每环的 `taken` / `done` —— **注意这是模块级可变常量**，见下面的坑 |
| `Scene` (`game/scene.ts`) | `forage[]` 每处的 `gone`（采集点重生倒计时） |

外加玩家位置 `player.x/y`。**不要存**室内状态：存档只在睡觉时写，那时玩家一定在自己床边。

## 明确不做的

- 不存 `scene.decos` / `solids` / `lights` / 地形——这些是由固定种子程序生成的，重新烘焙即可，
  存下来只会让存档膨胀几百 KB 并且和代码版本绑死。
- 不做多存档槽、不做云同步、不做手动存档键。**睡觉自动存档**，一个槽位。
- 不做存档加密或校验和。这是单机种田游戏，玩家改自己的存档是他们的自由。

## 任务清单

### 1. 新文件 `src/game/save.ts`

- `SAVE_KEY = 'rivervale.save.v1'`，`SAVE_VERSION = 1`
- `serialize(state): SaveData` / `apply(data, state): boolean`
- **版本迁移兜底**：读到的 `version` 不认识，或者 JSON 解析失败，或者任何字段形状不对，
  一律**当作没有存档**返回 false，绝不要让一个坏档把游戏卡在崩溃的启动路径上。
  改了存档结构就升 `SAVE_VERSION`，老档直接作废（当前阶段不写迁移代码，但把版本号留出来）。
- 每个字段读进来都要**校验并夹紧**：`stage` 夹到 0..3、`crop` 必须在 `CROPS` 里、
  `item` 必须在 `ITEMS` 里、数量非负、`selected` 夹到 0..9、`gold` 非负有限。
  M01 的农场预置数据就是靠这套校验才敢往 `tiles` 里写东西，同样的纪律。

### 2. `QUESTS` 是模块级可变常量——这是最大的坑

`social.ts:273` 的 `QUESTS` 是一个模块级数组，`taken` / `done` 直接写在上面。
它**不随 `new Social()` 重置**。这意味着：
- 存档必须存 `QUESTS.map(q => [q.taken, q.done])`
- 「新游戏」必须把它显式重置回全 false，否则开新档会继承上一局的任务进度

顺手把这个隐患记在代码注释里。

### 3. 接进 `main.ts`

- `nextDay()` 末尾自动存档（睡觉是唯一的存档点，和这个类型的游戏一致）
- 启动时读档：有档就 `apply()`，没有就走现在的初始化
- 存档失败（`localStorage` 满了、隐私模式禁用）**不能崩游戏**：`try/catch` 掉，
  在 HUD 上给一行提示就够了

### 4. 标题界面

启动时如果有存档，显示一个极简的选择：`CONTINUE - DAY n` / `NEW GAME`。
`W`/`S` 选、`E` 确认。选新游戏要**二次确认**（覆盖存档是不可逆的）。
用现有的 `src/engine/font.ts` 和 `ui.ts` 的画法，不要引入新的 UI 框架。

### 5. dev 钩子

`window.game` 加 `save()` / `load()` / `wipe()`，让验收能直接调，不用真的走一遍睡觉。

## 验收标准

1. `npx tsc --noEmit`、`npx vite build` 通过
2. **一个完整的往返**（用 Playwright 脚本跑，不要只靠肉眼）：
   开荒 → 种 → 浇 → 睡 → 记下 `state()` → 刷新页面 → CONTINUE → `state()` 与刷新前一致，
   且农田每一格、金钱、好感、任务进度都对得上
3. **坏档不崩**：往 `localStorage` 塞 `'{'`、塞 `'{"version":999}'`、塞一个 `stage: 99` 的合法 JSON，
   三种情况都要能正常启动（当作新游戏）
4. **新游戏是干净的**：读档玩到第 3 天 → 新游戏 → 任务链回到第一环、金钱回到 500、农田回到预置状态
5. 截图：标题界面一张

## 迭代记录

_（待填）_
