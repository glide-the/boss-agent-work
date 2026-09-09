# BOSS 聊天页操作坑位清单（2026-07-22 实战复盘）

按严重程度排序。P1/P2 都真实造成过消息发错会话。

## P1 虚拟列表索引偏移：evaluate 与 click 之间的重排窗口

`clickListConv` 的模式是：evaluate 找 `li` 下标 → `locator.nth(idx).click()`。
列表按最新消息时间排序且虚拟滚动，两次调用之间列表可能重排，`nth(idx)` 落到别人头上。

真实事故：
- 点「付艳琼」实际打开 IT 技术支持会话，发去 3 句"同意发简历"，而对方根本没要简历
- 点「倪女士」实际打开自动化工程师会话，发去 2 句通用收尾

强制规则：
1. 点击后必须 `extractConv()` 核对 `name`/`pos` 与预期一致再发送；不一致立即中止该条。
2. 优先 `openConvBySearch()`（搜索结果直接命中会话，无索引窗口）。
3. 在未读筛选列表中处理时，每处理完一条列表会变（已读条目消失），下一条重新扫描再点。

## P2 同意/拒绝误触：hasText 模糊匹配命中「拒绝」

`locator('span.card-btn', { hasText: '同意' })` 曾实际点成「拒绝」，产生
「您已拒绝向对方发送简历」系统消息，只能文字补救。

强制规则：只用 `resume.js` 的 `agreeAndSendResume()`——按钮组内逐一核对文本严格等于
「同意」，group+btn 双下标点击，点击后立即检查误拒系统消息。

## P3 内核频繁重置

- node_repl 内核约 30s 无响应或超时即重置，所有 `var` 绑定和函数定义丢失。
- 重置后必须：重新 import 模块 → `connectAndOpenChat()` → 重新定义/调用函数。
- 单次 js 调用控制在 30s 内；批处理每批 ≤5 个会话。
- 所有进度立即落盘（内核无法写文件，用 `nodeRepl.write(JSON)` 输出后由 shell 追加到 JSONL）。
- 内核中 `node:fs/os/path` 不可用：Chrome 插件路径先在外部 shell 探测后硬编码传入。

## P4 认领的用户标签页没有 playwright 能力

`browser.user.openTabs()` + `claimTab()` 拿到的 tab，`playwright` 为空对象，
任何 evaluate 都 30s 超时（表现为页面"卡死"）。一律 `browser.tabs.new()` 开新标签页。

## P5 消息流虚拟化：打开会话不一定渲染最新几条

打开会话后 slice(-3) 可能看不到刚发的消息，误判"回复丢失"。
核验我方回复时先 `scrollConvToBottom()` 再提取。

## P6 招聘方文字要简历 ≠ 可以发简历

对方打字"方便发一份简历吗"时，工具栏「发简历」是 `unable` 禁用态，也没有请求卡片。
正确话术：请对方点「求简历」发起，"您点一下我这边立即发送"。
只有出现 `.message-card-buttons` 的正式请求卡片时才能走 `agreeAndSendResume()`。

## P7 未读徽标跨标签页不清除

在 A 标签页回复过的会话，B 标签页（或刷新后）的未读列表里可能仍带徽标。
以"点进会话滚到底看最后一条是谁"为准，不以徽标为准。

## 其他

- 个人插件当前版本不应访问 `ab.chatgpt.com`；若出现 `ERROR [Statsig]`，停止任务并检查实际插件版本和 `latest` 指向。
- `tab.cua.scroll` 参数是 `{x, y, scrollX, scrollY}`；写 `deltaY` 会报错。
- `tab.playwright.keyboard` 不存在；清空输入用 `locator.fill("")`。
- 列表限流（只剩约 50 条且滚动不加载）时，滚动找人不可靠，直接搜索。
