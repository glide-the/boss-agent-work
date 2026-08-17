# Round 07：site_status 本地化与默认关闭

## Optimized Prompt

在 `/Users/dmeck/project/boss-agent-work/develop` 中定位 `browser-client.mjs` 的可维护来源及 `site_status` 真实调用链，确认是否存在生成源码；在不触碰 origin 授权、文件传输授权和其他浏览器安全机制的前提下，实现专用配置 `BROWSER_USE_SITE_STATUS_CHECK_ENABLED`（默认关闭）与 loopback-only 的 `BROWSER_USE_SITE_STATUS_BASE_URL`。启用时兼容现有 `/aura/site_status` 请求参数和 `feature_status.agent` 语义；服务超时、连接失败、非 2xx、无效 JSON 或字段缺失全部 fail-open，并仅记录脱敏诊断信息；`agent === false` 保持现有阻止错误。

先完成根因证据、设计稿、Mermaid 多分支时序和防过度设计评审，再修改最小模块、测试、配置示例和构建流程。不得直接把插件缓存中的压缩产物当作唯一长期实现，也不得使用全局 `disabled-for-local-testing` 绕过全部安全机制。

## Optional Enhancers

- 已采用：启用时固定 2 秒本地请求超时，不增加额外可调重试系统。
- 已采用：保留 24 小时成功决策缓存和同 host 并发请求合并；失败不缓存。
- 已采用：缺少上游源码时使用独立策略源码 + 确定性 bundle 适配脚本。
- 不采用：实现本地 Mock 服务；单元测试使用注入 fetch 已足够。
- 不采用：兼容或回退远程 ChatGPT 地址。

## 诊断 checkpoint

- 当前 bundle：`components/codex-plugin/scripts/browser-client.mjs`。
- 修改前 SHA-256：`ba7d5056235118520afd460b2c86a4ab6952856619cab8187543f295714f932a`。
- 当前硬编码：`https://chatgpt.com/backend-api`。
- 当前解析：只有 `feature_status.agent === true` 被视为允许，字段缺失被视为阻止。
- 当前异常：fetch、HTTP 非 2xx 或 JSON 解析异常最终被 `throwIfBlocksUrl` 捕获并放行。
- 当前全局跳过：`BROWSER_USE_SECURITY_MODE=disabled-for-local-testing` 同时跳过 URL policy/site status 和多项用户授权，不符合本轮目标。
- 搜索结果：Boss 工作区、原始 Codex Home、Round 52 和 Electron 语义恢复目录均未发现 browser client 的未打包生成源码。

## 最小实现计划

1. 新增 `site-status-policy.mjs`，封装开关、loopback 配置、协议、超时、缓存、fail-open 和脱敏日志。
2. 新增幂等补丁器，把 bundle 的 site status 纵切面适配到该模块，并移除远程基址。
3. 组装 marketplace 时对输出再次执行补丁；验证时检查源码和全部 profile。
4. 新增 Node 单元测试与 bundle 集成断言。
5. 更新设计、故障说明、环境变量示例和手动安装说明。

## 验收标准

- 默认和 `false` 完全不调用 fetch。
- 只有显式 `true` 启用，且 base URL 必须是 `127.0.0.1`、`localhost` 或 `[::1]`。
- bundle 与构建产物的 site status 纵切面不再使用 `chatgpt.com/backend-api`；无关的 `/aura/identity` 调用保持不变。
- agent true/false、超时、连接失败、非 2xx、无效 JSON、字段缺失均有测试。
- bundle 中基础 URL policy、origin consent、文件传输和安全模式代码保持存在。
- 插件验证、测试、三档构建和打包通过。
