# 故障处理与平台行为备忘

## 每日沟通额度

- BOSS 每日「立即沟通」上限约 150 次。接近上限时点击后弹「您今天已与N位BOSS沟通，还剩X次」+「好」；`process.js` 会自动点「好」完成沟通，并把弹窗文本记入 `rec.quotaNotice`。
- 耗尽后点击「立即沟通」不跳转聊天页，toast 提示「您今天已与150位BOSS沟通，休息一下，明天再来吧～」；此时结果表现为 `chat-open-failed`，需确认为额度问题后更正为 `daily-limit` 并停止当天任务。
- 额度按自然日重置，次日用 `createProgress` 恢复断点续跑。

## WAF 限流

- 症状：`tab.goto` 后 URL 长时间（>15s）不变、页面不加载，但 curl 访问正常。
- 处理：立即停止，冷却 1-2 小时自愈；不要刷新轰炸或换工具绕过。

## 内核重置（node_repl）

- 单次 js 调用超过约 60-110 秒会重置内核，所有顶层绑定丢失。
- 预防：每批最多 5 个岗位；状态全部落盘（progress JSONL）。
- 恢复：重新 `import` 模块 → `setupChrome()` → `createProgress(...)` → 重扫当前分类 → `makeQueue` 去重 → 继续批处理。

## Chrome 插件目录升级

- 插件缓存路径含版本号（如 `.../chrome/26.601.21317`），升级后旧路径失效，import `browser-client.mjs` 报 Module not found。
- `browser.js` 的 `resolvePluginRoot()` 已自动回退到 `.../chrome/latest`；若仍失败，检查 `~/Downloads/codex-original-dmg-codex-home/plugins/cache/openai-bundled/chrome/` 下实际目录。

## 列表与去重

- BOSS 列表每次渲染重新生成加密 jobId，跨页去重必须用标题（doneKeys 双向前缀 10 字），同标题不同公司只处理第一个。
- 搜索结果随时间变化，重扫会出现新岗位，属正常现象。
- 详情页按钮为「继续沟通」= 历史已沟通，跳过。

## 详情页校验

- `extractJobDetail` 返回 `{ title, chatBtnText, blocked }`；`blocked` 为真说明出现安全验证，立即停止。
- 标题与详情职责/地点冲突时以详情为准；不符筛选规则记录跳过原因。
