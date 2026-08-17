# Round 02：Boss投递手动安装使用说明

## Optimized Prompt

为 `/Users/dmeck/project/boss-agent-work/develop` 编写一份可直接执行的 Boss投递 macOS 本地手动安装说明。说明必须覆盖依赖检查、仓库获取、构建档位选择、Codex marketplace 注册、`chrome-dev` 插件安装、Electron Main Native Host reconcile、Chrome 解压扩展加载、分层验证、升级、卸载和回滚。

命令应明确区分源码工程、可再生构建物、Codex 插件 cache、Chrome profile 和用户 NativeMessagingHosts 目录。必须使用 Boss投递独立身份 `jigmpnbdhhempldjgegphdgkochgpagi` / `com.openai.codexextension.dev`，不得删除或覆盖官方 `com.openai.codexextension`。应明确当前 Codex CLI 的 `plugin add` 只复制插件，宿主 Electron 尚未接入本项目生命周期时，需要手动执行一次 reconcile；同时提供一个可测试的命令行入口，避免用户复制复杂的内联 Node 代码。

验证结果按 `extension-installed`、`manifest-valid`、`runtime-published`、`port-connected` 和 `browser-action-verified` 分层；不得用 manifest 文件存在替代端到端页面动作。扩展文件发生变化后必须提示在 `chrome://extensions` 中 reload。

## Optional Enhancers

- 已采用：提供最短安装路径和逐步详细说明。
- 已采用：提供 reconcile CLI 的 `--dry-run` 与 JSON 输出。
- 已采用：分别说明 ChatGPT.app 和 Codex.app Runtime 路径。
- 已采用：提供只删除 Boss投递 dev 身份的回滚边界。
- 不采用：制作 GUI 安装向导；本轮文档和单用途 CLI 已足够。

## 当前输入与 checkpoint

- settled：插件版本 `26.707.30751-standalone.3` 已构建、安装并完成 live Native Port 验证。
- settled：Electron Main lifecycle 位于 `components/electron-app/`。
- planned：增加手动 reconcile CLI 和正式使用说明。
- 当前开发机：macOS arm64；baseline Native Host 只有 arm64 签名产物。

## 范围与非目标

- 范围：macOS arm64 本地开发/测试安装，包含 baseline、extension-dev 和 full-reconstructed 的选择说明。
- 非目标：Chrome Web Store 正式发布、Windows/Linux 交付、Electron Renderer 安装 UI、自动执行 BOSS 业务动作。

## 生产接入与调用图

```text
Codex CLI plugin add
  -> version cache（仅复制）
  -> reconcile-native-host CLI / Electron onDidInstall
  -> BossPluginNativeHostLifecycle
  -> installManifest.mjs
  -> latest + manifests + host config + schema-v2 registries
  -> Chrome connectNative
```

本轮不恢复新的 AST/CFG/SCC 语义；CLI 只是既有 Electron Main lifecycle 的薄入口，不复制 Native Host 协议逻辑。

## 测试与门禁

- CLI `--help` 和 `--dry-run --json` 可在不写用户目录的隔离 fixture 中执行。
- `make electron`、`make verify` 继续通过。
- 文档中的路径与当前构建输出、CLI 参数和插件身份一致。
- 只有实际 `extension-host` 进程或浏览器客户端成功才能标为 `port-connected` / `browser-action-verified`。

## 回滚

- marketplace source 可切回旧路径或移除。
- plugin remove 只指定 `chrome-dev@codex-chrome-automation-local`。
- manifest/registry 清理只匹配 Boss投递扩展 ID和 dev Host；不提供宽泛递归删除命令。

## 输出路径

- 使用说明：`docs/manual-install.md`
- CLI：`components/electron-app/bin/reconcile-native-host.mjs`
- CLI 测试：`components/electron-app/test/manual-install-environment.test.mjs`

## 执行结果

- settled：新增 `reconcile-native-host.mjs`，支持自动识别 ChatGPT.app/Codex.app Runtime、显式路径覆盖、`--dry-run` 和 JSON 输出。
- settled：首次安装尚未生成 cache 时，dry-run 明确返回 `versionRoot: null` 和 `missing`，不再误报当前工作目录。
- settled：Electron lifecycle 测试由 6 项增至 8 项，全部通过。
- settled：`make package` 和完整 `make verify` 通过，三个压缩包都包含可执行 reconcile CLI。
- settled：手动安装说明覆盖构建、marketplace、插件、Native Host、Chrome、验证、升级、卸载与回滚边界。
