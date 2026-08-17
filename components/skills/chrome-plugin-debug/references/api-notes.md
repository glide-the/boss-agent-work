# 插件 API 形态备忘

node_repl 内核中 `tab.playwright` 是 Playwright 子集，与完整 Playwright 有差异：

- `tab.goto(url)`、`tab.playwright.evaluate(fn)`、`tab.playwright.waitForTimeout(ms)`、`tab.playwright.waitForLoadState({ state, timeoutMs })`、`tab.playwright.getByText(...)`、`locator.click({ timeoutMs })`、`locator.fill("")` 可用。
- `tab.playwright.keyboard` 不存在；清输入用 `locator.fill("")`，发送用回车由业务模块封装。
- `tab.cua.scroll` 参数签名是 `{x, y, scrollX, scrollY}`；写 `deltaY` 会报错。
- 内核环境限制：`node:process` 被禁；`node:fs/os/path` 不可用；`process.env` 读不到。需要文件路径、目录探测时，先在外部 shell 完成，把结果以字符串硬编码进 js 调用。
- 本地文件模块（绝对路径 `.js`/`.mjs`）每次动态 `import` 都会重新加载，适合内核重置后恢复；顶层 `const` 重复声明会报错，可复用绑定用 `var` 或 `globalThis.x = ...`。
- 输出用 `nodeRepl.write(text)`（无附加换行，适合 JSON）；`console.log` 用于调试。宿主遥测 `ERROR [Statsig]` 与业务无关。
