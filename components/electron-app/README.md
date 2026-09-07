# Boss投递 Electron Main 集成

这个组件负责 Electron 应用侧的插件安装生命周期。它不包含 Renderer，也不自行安装 Chrome 扩展。

生产入口调用 `registerBossPluginNativeHostLifecycle()`：

```js
import { registerBossPluginNativeHostLifecycle } from "./src/boss-plugin-native-host-lifecycle.mjs";

const lifecycle = registerBossPluginNativeHostLifecycle({
  app,
  pluginInstaller,
  codexHome,
  resourcesPath: process.resourcesPath,
  runtimePaths: {
    codexCliPath: path.join(process.resourcesPath, "codex"),
    nodePath: path.join(process.resourcesPath, "node"),
    nodeReplPath: path.join(process.resourcesPath, "node_repl"),
  },
  onError: (error) => logger.error("Boss投递 Native Host 初始化失败", error),
});
```

`pluginInstaller` 只需要实现 `onDidInstall(listener)`；安装事件应提供 `marketplaceName`、`pluginName`，最好同时提供 `versionRoot`。Electron `ready` 后组件也会扫描当前安装并 reconcile，因此旧版本升级或遗漏事件可以自愈。

宿主尚未接入生命周期时，可以手动执行同一套逻辑：

```bash
bun bin/reconcile-native-host.mjs --dry-run --json
bun bin/reconcile-native-host.mjs --json
```

完整环境安装说明见 [manual-install.md](../../docs/manual-install.md)。

## 个人指纹配置与信任边界（2026-09-07）

`NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` 是旧版宿主的共享 Browser Client allowlist，不是个人插件身份，也不是操作系统变量。本项目不追加或覆盖该变量。个人插件通过自己的 `.mcp.json` 启动 `boss_repl`，并只在该子进程注册 `boss_browser` trusted service；启动器会删除继承到子进程的旧 SHA 变量，官方 `browser` 服务保持不变。

个人插件只读取专用变量 `BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256`，作为受审查 Browser Client 文件的预期 SHA-256；默认未设置。优先级为 `--expected-browser-client-sha256` 参数、该环境变量、未指定。它仅用于完整性比较，不能授予宿主信任，也不会被传递为宿主 SHA256S 信任列表。请将经过审查的发行产物哈希保存在自己的终端或运行命令环境中，不要放进宿主的全局 shell_environment_policy。

```bash
BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256="<受审查产物的64位SHA-256>" \
  bun components/electron-app/bin/reconcile-native-host.mjs --dry-run --json
bun components/electron-app/bin/reconcile-native-host.mjs --codex-home /absolute/personal-codex --dry-run --json
```

命令逐项报告 `PLUGIN_NOT_INSTALLED`、`PLUGIN_DISABLED`、`MCP_TOOL_APPROVAL_REQUIRED`、`MCP_TOOL_APPROVAL_CONFLICT`、`MCP_TOOL_DISABLED`、`MCP_SERVER_DISABLED`、`PLUGIN_UNTRUSTED`、`FINGERPRINT_MISMATCH`、`USER_CONFIG_ERROR`、`INVALID_ENVIRONMENT`、`CONFIG_CONFLICT`、`POLICY_REVIEW_REQUIRED`、`POLICY_REJECTED`、`RUNTIME_INCOMPATIBLE` 或 `RUNTIME_UNVERIFIED`。只有真实 `boss_browser` ping 返回匹配 nonce、服务名、协议版本且受信 worker 可见 `nativePipe` 时，`effectiveTrust` 才是 `isolated-service-authorized`；`recorded` 仅保留为旧 allowlist 诊断。

通过前置检查后，初始化器先把 `config.toml` 与 Native Host 目标备份至所选 `CODEX_HOME/backups/personal-plugin-native-host-*/snapshot.json`。缺少个人工具授权时，它通过 Codex App Server 只 upsert `plugins."chrome-dev@codex-chrome-automation-local".mcp_servers.boss_repl.tools.js.approval_mode = "approve"`，并使用用户层 `expectedVersion` 防止并发覆盖。显式拒绝、server/tool 禁用和企业覆盖都会停止初始化。

```bash
bun components/electron-app/bin/rollback-native-host.mjs /absolute/path/to/snapshot.json
```

回滚前检查文件是否在初始化后被其他进程修改，冲突时拒绝覆盖。初始化失败也会密封快照，供人工恢复本轮配置和 Host 目标。直接 Electron 生命周期 API 仍仅注册 Native Host；完整的个人授权流程应使用 reconcile CLI。

设计、证据与完整限制见 [personal-plugin-trust-design.md](../../docs/personal-plugin-trust-design.md)。新启动的临时 Codex 任务已经发现 `boss_repl` 并完成真实 Chrome 标签页只读调用；当前 Desktop GUI 仍需完整重启后确认工具目录刷新。
