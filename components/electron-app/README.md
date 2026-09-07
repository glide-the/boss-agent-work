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

命令逐项报告 `PLUGIN_NOT_INSTALLED`、`PLUGIN_DISABLED`、`PLUGIN_UNTRUSTED`、`FINGERPRINT_MISMATCH`、`USER_CONFIG_ERROR`、`INVALID_ENVIRONMENT`、`CONFIG_CONFLICT`、`POLICY_REVIEW_REQUIRED`、`RUNTIME_INCOMPATIBLE` 或 `RUNTIME_UNVERIFIED`。只有真实 `boss_browser` ping 返回匹配 nonce、服务名、协议版本且受信 worker 可见 `nativePipe` 时，`effectiveTrust` 才是 `isolated-service-authorized`；`recorded` 仅保留为旧 allowlist 诊断。

通过前置检查后，注册会先备份 Native Host 目标至所选 CODEX_HOME/backups/personal-plugin-native-host-*/snapshot.json，再调用原注册器。返回 `nativeHostRegistered` 和 `connectionVerified=false`，不再用笼统的 correct 表示整体就绪。同一次初始化成功后的回滚命令：

```bash
bun components/electron-app/bin/rollback-native-host.mjs /absolute/path/to/snapshot.json
```

回滚前检查文件是否在初始化后被其他进程修改，冲突时拒绝覆盖。注册失败保留原始快照供人工恢复，不自动回滚并发写入。config.toml 始终只读，因此不存在需要恢复的信任配置修改。直接 Electron 生命周期 API 仍仅注册 Native Host；它不是信任安装器，也不代表 Browser Client 连接已验收。

设计、证据与完整限制见 [personal-plugin-trust-design.md](../../docs/personal-plugin-trust-design.md)。动态服务授权已经验证；真实 Chrome 连接仍需在 Desktop 重新加载插件后的新会话做轻量读取。
