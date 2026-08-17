---
name: boss-job-greet
description: 通过 Codex Chrome 插件（@Chrome / node_repl 内核）遍历 BOSS 直聘岗位搜索页（zhipin.com/web/geek/jobs），按筛选规则对目标岗位执行「立即沟通」并发送分句求职消息。当用户要求批量投递/沟通 BOSS 直聘岗位、遍历某个搜索关键词或分类（如 AI情感陪伴、算法工程师、IT技术支持 + 城市）、自动点击立即沟通、发送打招呼消息、断点续投，或给出 zhipin.com 岗位搜索 URL 要求处理时使用。求职消息必须按当前任务的目标方向自动生成（见 references/message-generation.md），不得套用与任务无关的模板。
---

# BOSS 直聘岗位「立即沟通」自动化

在已登录 BOSS 账号的 Chrome 中，遍历岗位搜索列表 → 过滤 → 立即沟通 → 分句发送求职消息 → 落盘去重，直到分类遍历完成或触发平台限制。

## 硬性约束

- 只使用 Codex Chrome 插件（node_repl 内核的 `tab.playwright`）。禁止本地 Playwright/Selenium/Puppeteer/agent-browser 直连 BOSS；@Chrome 不可用时立即停止并报告。
- 出现滑块/短信验证/账号异常/每日沟通上限（如「您今天已与150位BOSS沟通」）时立即停止，不绕过，落盘并报告。
- 「立即沟通」是对外不可逆操作：仅在用户已明确授权批量沟通时执行；额度提示弹窗（「您今天已与N位BOSS沟通」+「好」）属于平台自身的确认步骤，点「好」即完成沟通，不点击其他确认按钮。
- 不虚构执行结果；所有状态以页面实际返回为准。输出中的 `ERROR [Statsig]` 是宿主遥测噪音，忽略。

## 模块

脚本位于 `scripts/job-greet/`（与项目 `/Users/dmeck/project/boss-agent/src/job-greet/` 同源，改动需两边同步）：

| 模块 | 职责 |
| --- | --- |
| `browser.js` | Chrome 插件引导，`setupChrome()` 幂等重连（内核重置后可恢复） |
| `urls.js` | 已知分类 URL 样例；新任务按 URL 构造规则动态生成 |
| `scan.js` | `scanCards` / `scanAllWithScroll`（连续两次滚动无新增即停） |
| `detail.js` | 详情校验 `extractJobDetail`、聊天页检测 `checkChatPage` |
| `chat.js` | `sendMessages` 分句逐条发送（每句一条 Enter） |
| `filter.js` | 跳过规则、标题去重、`makeQueue` |
| `messages.js` | 内置消息模板（兜底）+ `setMsgsForKind` 动态注册（优先） |
| `process.js` | `processJobByUrl` 单岗全流程、`runChunk` 批处理（遇 daily-limit/blocked 自停） |
| `progress.js` | `createProgress` JSONL 落盘与断点恢复 |
| `index.js` | `processCategory` 编排 |

## 执行流程

1. **解析任务**：从用户任务（如「四、当前任务」）提取目标分类列表，每项形如 `关键词(城市)`。
2. **生成消息集**：按 `references/message-generation.md`，为每个目标方向从简历自动生成消息生成函数，用 `setMsgsForKind` 注册。内置模板仅作兜底。
3. **构造搜索 URL**：`https://www.zhipin.com/web/geek/jobs?city=<城市码>&query=<encodeURIComponent(关键词)>`。已知城市码：杭州 `101210100`，北京 `110100`，上海 `101020100`，深圳 `101280600`，广州 `101280100`；其他城市先在 BOSS 页面手动切换城市后从地址栏取码。
4. **逐分类执行**：打开 URL → `scanAllWithScroll` → `makeQueue(cards, progress.doneKeys)` 去重过滤 → 按 5 个/批 `runChunk`，每批后汇报简短进度。
5. **停止条件**：额度/风控触发即全停；单岗失败记录原因继续；连续两次滚动无新增视为分类遍历完成；完成一个分类再进下一个。
6. **最终报告**：分类统计、成功清单（岗位/公司/城市/结果）、跳过及原因、失败及原因、是否遍历到末尾、是否遇到风控、确认未使用本地自动化工具。

## 标准调用（node_repl 内核）

```js
const JG = await import("/Users/dmeck/.agents/skills/boss-job-greet/scripts/job-greet/index.js");
globalThis.JG = JG;
const { tab } = await JG.setupChrome();           // 幂等，内核重置后重调即可
globalThis.tab = tab;
const progress = await JG.createProgress(JG.PROGRESS_FILE, []);

// 按任务方向动态生成消息（详见 references/message-generation.md）
JG.setMsgsForKind("ai", (title) => [ `您好，我对贵司「${title}」…`, "…", "…", "…" ]);

await tab.goto(searchUrl);                         // 步骤 3 构造的 URL
await tab.playwright.waitForTimeout(4000);
const cards = await JG.scanAllWithScroll(tab);
const queue = JG.makeQueue(cards, progress.doneKeys, "ai");
const { results, stopped } = await JG.runChunk(tab, queue.slice(0, 5), "关键词(城市)", progress, null);
```

单次 js 调用控制在约 60 秒内（5 个岗位/批），超时会导致内核重置；所有状态必须经 `progress` 落盘，重置后重新 import + `setupChrome` + `createProgress` 即可续跑。

## 筛选与去重要点

- 只处理与任务方向直接相关的技术/产品岗；跳过销售、客服、主播、运营、行政、人事、教培、心理咨询、陪聊、标注、编剪等非目标岗。标题与详情冲突时以详情职责和工作地点为准。
- 跨页/跨渲染去重用岗位标题（`doneKeys` 双向前缀 10 字），不用 jobId——BOSS 每次渲染都重新生成加密 jobId。
- 详情页按钮显示「继续沟通」的一律跳过（已建立沟通，避免重复打扰）。
- 详情未加载重试一次仍失败则记录跳过；无「立即沟通」按钮记录原因跳过。

更多故障处理（WAF 限流、内核重置、插件目录升级、额度弹窗形态）见 `references/troubleshooting.md`。
