# Boss投递 Codex 插件发布与使用说明

发布日期：2026-09-07

插件版本：`26.707.30751-standalone.9`

Chrome 扩展版本：`1.1.5.2`

适用平台：已验证 `macOS arm64`

本文是 `chrome-dev@codex-chrome-automation-local` 当前版本的发布入口，覆盖制品选择、源码映射、构建、安装、升级、配置、使用、验证和回滚。逐项安装参数见 [manual-install.md](manual-install.md)，身份与信任证据见 [personal-plugin-trust-design.md](personal-plugin-trust-design.md) 和 [personal-plugin-trust-results.md](personal-plugin-trust-results.md)。

## 1. 发布内容与身份

本版本包含三组相互配合的改动：

- 个人 Browser Client 恢复对 Chrome Extension void JSON-RPC 响应的基线兼容：当成功响应只含 `jsonrpc` 和匹配 `id` 时，以 `undefined` 结束请求，避免 `nameSession`、导航等已执行操作固定挂起到工具超时。设计和证据见 [browser-void-response-hang-design.md](browser-void-response-hang-design.md)。
- Browser Client 和源码 Chrome Extension 支持可取消的浏览器操作。DOM snapshot 超时、调用方取消、JavaScript Dialog、标签关闭或浏览器断连时，会清理 pending request 并返回结构化取消原因。
- 个人插件不再依赖旧的 `NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` 共享 allowlist。插件自带 `boss_repl` MCP，并在其子进程中注册独立的 `boss_browser` trusted service。
- Native Host 用户级注册增加只读 preflight、写入前复核、备份、幂等更新和冲突保护；不会覆盖官方 Host `com.openai.codexextension`、其他插件 registry entry 或企业策略。
- 初始化器通过 Codex App Server 只授权个人插件的 `boss_repl.js` 工具；用户层版本条件、快照和显式策略冲突检查避免覆盖其他配置。
- 发布组装会排除 AppleDouble 和 `.DS_Store`，打包后会拒绝 macOS 元数据与不安全路径；Rust 重建 Host 会把工作区、Cargo 和用户主目录重映射为稳定路径。
- `boss_repl` 不再从 Codex Code Mode 工具目录中排除；技能从实际 `SKILL.md` 路径解析插件根目录，避免升级后继续引用已删除的版本目录。

| 对象 | 值 |
| --- | --- |
| 产品名称 | `Boss投递` |
| 插件选择器 | `chrome-dev@codex-chrome-automation-local` |
| marketplace | `codex-chrome-automation-local` |
| 安装作用域 | 当前用户的 `CODEX_HOME` |
| Chrome 扩展 ID | `jigmpnbdhhempldjgegphdgkochgpagi` |
| Native Messaging Host | `com.openai.codexextension.dev` |
| 私有 MCP server | `boss_repl` |
| 私有 trusted service | `boss_browser` |

这些标识承担不同职责，不能互相替换。Browser Client 的 SHA-256 是发行文件完整性摘要，不是扩展 ID、Host 名称、代码签名或永久插件身份。

## 2. 制品与源码映射

`make package` 在本地生成以下三个归档。`dist/` 和 `artifacts/` 被 `.gitignore` 排除，归档不会随源码提交进入 Git；发布或拷贝归档时必须同时交付对应的 `.sha256` 文件。

| 档位 | Chrome Extension 来源 | Native Host 来源 | 用途 | 2026-09-07 SHA-256 |
| --- | --- | --- | --- | --- |
| `baseline` | `baselines/chrome-extension` | `baselines/native-host/macos/arm64/extension-host` | 推荐安装和签名基线回归 | `e345f2548f9ecf086bd07cb6a77a3baf72b0af1dff3fc1f73da3fade004a4607` |
| `extension-dev` | `dist/chrome-extension`，由 TypeScript/React 源码构建 | 签名基线 Host | 验证本版本 Dialog/取消协议和扩展改动 | `8c56b3dcb83efceaee586b78f4fd022b79b8f21824374e2ec2b36620711de41c` |
| `full-reconstructed` | `dist/chrome-extension` | `dist/native-host/macos/arm64/extension-host`，由 Rust 源码构建 | 协议研究和源码重建验证 | `ac9e949248263680410475f8d7f0644c17e53a5813aa36e0a48b7770c8b76978` |

表中摘要对应本次最终打包的具体文件。当前归档脚本会保留构建物元数据，重新构建可能产生新的归档摘要；交付时应以同批次生成的 `.sha256` sidecar 为准，不能把表中值当作版本的永久身份。

`baseline` Host 文件 SHA-256 是 `7092676b829e09bab4fac2b4ca037b38e6640b6cdce2d63d6d858ef58c90f89f`，签名 Team ID 为 `2DC432GLL2`。`full-reconstructed` Host 文件 SHA-256 是 `800183c7b4a187bfc9644876361f4a13d44cdffa316b7dae0200488fad862ac5`，只有 ad-hoc 签名，因此不建议生产使用。

每个归档包含：

```text
marketplace/     可由 Codex CLI 注册的本地 marketplace 和 chrome-dev 插件
electron-app/    Electron Main 生命周期模块与手动 reconcile/rollback CLI
```

每个 marketplace 的 `BUILD-PROVENANCE.json` 记录实际档位、扩展来源和 Host 来源。权威源码和生成物关系如下：

| 范围 | 权威输入 | 生成或组装输出 |
| --- | --- | --- |
| Browser Client | `components/codex-plugin/src/browser-client/` | `components/codex-plugin/scripts/browser-client.mjs` |
| trusted service | 同上 | `browser-service.mjs`、`launch-browser-service.mjs` |
| Chrome Extension | `components/chrome-extension/src/`、`public/` | `dist/chrome-extension/` |
| Electron 生命周期 | `components/electron-app/` | `dist/electron-app/` |
| Rust 重建 Host | `components/native-host/` | `dist/native-host/macos/arm64/extension-host` |
| 签名基线 Host | `baselines/native-host/macos/arm64/extension-host` | 原样进入 `baseline` 和 `extension-dev` |

`components/codex-plugin/scripts-bak/` 保存原始恢复基线和本轮生成物修改前的唯一快照，不是当前权威源码。发布组装会排除插件的 `scripts-bak/`、`src/` 和 `test/`；安装包只保留运行时脚本、必要依赖、扩展、Host、技能、配置和用户文档，不公开开发依赖、测试夹具或恢复基线。当前清单摘要是 `e4f058ccdafa38a8e1028f6a944d9e98f2697efdee514dab76868689d7774d1f`（348 个文件）。

当前个人运行时文件摘要：

```text
browser-client.mjs          38a49b370f3ea42d20d5b89567d2a5064fb89720c34c0511d48f4489a24d5afd
browser-service.mjs         04ad2c2fe354c61f676844efa593da79a53837e7c067afdd43f907190b115f86
launch-browser-service.mjs  0c6a9d6ed3072a489e068b7279a4427bcc87a19a54d7474ae380bbc286fd56ca
```

## 3. 构建、验证和打包

JavaScript/TypeScript 依赖、构建和测试统一使用 Bun：

```bash
cd /Users/dmeck/project/boss-agent-work/develop
make setup
make verify
make package
```

需要单独构建时：

```bash
make browser-client
make extension
make electron
make native                 # 只有 full-reconstructed 需要 Rust
make baseline
make extension-dev
make full-reconstructed
```

打包后核对归档和 sidecar：

```bash
cd /Users/dmeck/project/boss-agent-work/develop/artifacts
shasum -a 256 -c boss-delivery-baseline.tar.gz.sha256
shasum -a 256 -c boss-delivery-extension-dev.tar.gz.sha256
shasum -a 256 -c boss-delivery-full-reconstructed.tar.gz.sha256
tar -tzf boss-delivery-baseline.tar.gz >/dev/null
tar -tzf boss-delivery-extension-dev.tar.gz >/dev/null
tar -tzf boss-delivery-full-reconstructed.tar.gz >/dev/null
```

## 4. 首次安装

推荐使用 `baseline`：

```bash
cd /Users/dmeck/project/boss-agent-work/develop
make baseline
make verify

BOSS_WORKSPACE="$PWD"
CODEX_DATA_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_CLI_BIN="$CODEX_DATA_DIR/plugins/.plugin-appserver/codex"

test -x "$CODEX_CLI_BIN"
"$CODEX_CLI_BIN" plugin marketplace add \
  "$BOSS_WORKSPACE/dist/baseline/marketplace" --json
"$CODEX_CLI_BIN" plugin add \
  chrome-dev@codex-chrome-automation-local --json
```

先执行只读 preflight；`ready=true` 后再注册用户级 Native Host：

```bash
bun components/electron-app/bin/reconcile-native-host.mjs --dry-run --json
bun components/electron-app/bin/reconcile-native-host.mjs --json
```

第二条命令会先在 `$CODEX_HOME/backups/personal-plugin-native-host-*/snapshot.json` 创建快照，再更新 `latest`、用户级 Chrome manifests、Host 配置和 registry。重复执行应返回 `no-op` 或等价的幂等结果。

在 `chrome://extensions/` 开启开发者模式，加载：

```text
/Users/dmeck/project/boss-agent-work/develop/dist/baseline/marketplace/plugins/chrome-dev/chrome-extension
```

确认名称为 `Boss投递`、扩展 ID 与本文一致。安装或升级插件后完整退出并重新启动 ChatGPT/Codex Desktop，使新 `.mcp.json` 和 `boss_repl` 被新任务加载。本文中的命令不会自动关闭 Desktop 或 Chrome。

如果新任务仍引用旧版本目录，或只读取到技能却看不到 `mcp__boss_repl__js`，Desktop 仍在使用安装前的插件快照。此时 `codex mcp list --json` 中出现 `boss_repl` 只能证明磁盘配置可解析；必须完整重启 Desktop 并创建新任务，才能验证工具目录已经刷新。

若要验收本版本的对话取消扩展代码，应改为构建和安装 `extension-dev`，并在 `chrome://extensions/` 重新加载对应目录。`baseline` 不包含这部分源码扩展改动。

## 5. 升级

```bash
cd /Users/dmeck/project/boss-agent-work/develop
git status --short
git pull --ff-only
make baseline
make verify

CODEX_DATA_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_CLI_BIN="$CODEX_DATA_DIR/plugins/.plugin-appserver/codex"
"$CODEX_CLI_BIN" plugin add chrome-dev@codex-chrome-automation-local --json
bun components/electron-app/bin/reconcile-native-host.mjs --dry-run --json
bun components/electron-app/bin/reconcile-native-host.mjs --json
```

preflight 会重新计算已安装 `browser-client.mjs` 的摘要。设置预期摘要时，版本变化导致的漂移会以 `FINGERPRINT_MISMATCH` 失败，不会自动把新值加入任何信任列表；必须先审核新制品，再更新调用环境中的期望值。

## 6. 配置与优先级

| 名称 | 用途 | 默认值与优先级 |
| --- | --- | --- |
| `CODEX_HOME` | 当前用户的配置、插件 cache、registry 和备份根目录 | `--codex-home` > 环境变量 > `$HOME/.codex`；必须是绝对用户目录，不能是文件系统根 |
| `BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256` | 将已安装 Browser Client 与已审查发行摘要比较 | `--expected-browser-client-sha256` > 环境变量 > 未设置；必须是 64 位十六进制 |
| `BOSS_PLUGIN_NODE_REPL_PATH` | 非标准 Desktop 布局中的 `node_repl` 绝对路径 | 环境变量 > ChatGPT/Codex 常见安装位置 |
| `BOSS_PLUGIN_NODE_PATH` | 与所选 Desktop 配套的 Node 绝对路径 | 环境变量 > 从 Resources 布局推导 |

示例：

```bash
BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256=\
38a49b370f3ea42d20d5b89567d2a5064fb89720c34c0511d48f4489a24d5afd \
  bun components/electron-app/bin/reconcile-native-host.mjs --dry-run --json

CODEX_HOME=/absolute/personal-codex \
  bun components/electron-app/bin/reconcile-native-host.mjs --dry-run --json
```

`NODE_REPL_TRUSTED_SERVICES` 由 launcher 为自己的子进程生成，只注册 `boss_browser`，无需用户配置。`NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` 仅作为旧版共享 allowlist 的诊断来源；个人 launcher 会删除继承值，它不是本版本初始化变量。初始化器只持久化 `plugins."chrome-dev@codex-chrome-automation-local".mcp_servers.boss_repl.tools.js.approval_mode = "approve"`，并拒绝覆盖显式用户拒绝或企业策略。

## 7. 使用方法

Desktop 重启后创建新任务，先做只读检查：

```text
使用 Boss投递检查当前 Chrome 标签页和 BOSS 直聘页面是否可读。只读取页面标题、URL 和可见岗位摘要，不发送消息、不投递简历。
```

正常链路是：

```text
Codex 任务 → chrome-dev:boss-delivery → boss_repl
  → boss_browser trusted service → Native Host → Boss投递 Chrome Extension
```

需要发送消息、投递简历或上传文件时，应在 Prompt 中明确目标、数量和批准边界。连接失败时停止并报告所在层级，不要自动改用 `agent-browser`、Playwright 或其他浏览器链路。更多常用 Prompt 和批量任务边界见仓库 [README](../README.md)。

## 8. 分层验收

```bash
CODEX_DATA_DIR="${CODEX_HOME:-$HOME/.codex}"
PLUGIN_ROOT="$CODEX_DATA_DIR/plugins/cache/codex-chrome-automation-local/chrome-dev/latest"

node "$PLUGIN_ROOT/scripts/check-extension-installed.js" --json
node "$PLUGIN_ROOT/scripts/check-native-host-manifest.js" --json
node "$PLUGIN_ROOT/scripts/verify-standalone.mjs" --live
jq '[.entries[] | select(.nativeHostNames[]? == "com.openai.codexextension.dev")]' \
  "$CODEX_DATA_DIR/chrome-native-hosts-v2.json"
```

| 层级 | 成功证据 |
| --- | --- |
| 安装 | 配置启用个人插件，`latest` 指向当前版本 |
| Host 注册 | manifest 和 registry 精确匹配个人扩展 ID/Host，且保留其他 entries |
| 服务授权 | preflight 返回 `effectiveTrust=isolated-service-authorized`、匹配 nonce、`nativePipeAvailable=true` |
| Chrome 连接 | Desktop 新任务中的 `boss_repl` 能列出真实 Chrome 标签页 |
| 页面操作 | 在只读页面完成一次短超时读取，未出现固定 30 秒挂起 |

`manifest-valid`、Host 进程存在或 `service-authorized` 都不能单独证明 Chrome 连接成功。

## 9. 回滚

优先使用本次 reconcile 返回的快照：

```bash
bun components/electron-app/bin/rollback-native-host.mjs \
  /absolute/path/to/personal-plugin-native-host-*/snapshot.json
```

若目标文件在快照创建后被其他进程改过，回滚会拒绝覆盖。移除插件可使用：

```bash
CODEX_DATA_DIR="${CODEX_HOME:-$HOME/.codex}"
"$CODEX_DATA_DIR/plugins/.plugin-appserver/codex" plugin remove \
  chrome-dev@codex-chrome-automation-local --json
```

随后只移除扩展 ID `jigmpnbdhhempldjgegphdgkochgpagi` 和 Host `com.openai.codexextension.dev` 对应的用户级记录。不要删除官方 `com.openai.codexextension.json`。恢复整个 `config.toml` 前必须人工审查差异，因为备份后可能已新增其他插件或项目配置。

## 10. 已验证结果与限制

发布前已完成的检查：

- Browser Client 构建、类型检查和 34 项单元测试通过；client → `boss_browser` → service roundtrip 通过。
- 当前 Desktop `node_repl` 的动态授权 ping 通过，`nativePipeAvailable=true`；受限 PATH `/usr/bin:/bin` 配合 bundled Node 的探针也通过。
- Electron 测试 18/18 通过；临时 `CODEX_HOME` 的首次、重复初始化、个人工具授权、配置保留和快照回滚通过。
- Chrome Extension 类型检查、构建通过；打包验证运行的插件测试为 16/16，Rust Native Host 测试 10/10 通过。
- 三个档位均通过 `make verify` 并成功生成可读取归档。
- 三个归档均通过公开发布审计：不包含 AppleDouble、`.DS_Store`、不安全路径或本机构建绝对路径。
- `boss_repl` 可在全新 Codex CLI 任务 `01a07ac8-ac88-72e0-8224-719ceaf44992` 中发现。该任务从 `.9` 路径加载 Browser Client，`nameSession` 在 15 ms 内返回，随后在同一真实 Chrome 标签页访问 `https://example.com/` 和 BOSS 公开搜索页并读取 URL/title；两次页面操作分别在 492 ms 和 468 ms 内完成，最终清理标签页。

仍需在目标机器验收：

- 当前已运行的 Desktop GUI 完整重启后是否立即刷新 `boss_repl` 工具目录；重启前创建的 GUI 任务仍登记 `.8`，因此没有执行浏览器操作。
- 本版本 Dialog/取消在真实 Chrome 页面上的回归；发布验收覆盖了会话命名与导航，没有触发 Dialog，也没有执行表单操作。
- 企业策略存在时的最终允许/拒绝结果，应由宿主和管理员策略决定。
- Windows HKCU Native Host 完整回滚尚未验证。

新启动的临时 Codex 任务已经通过个人服务列出真实 Chrome 标签页，因此 Chrome 连接已在该任务中确认；当前 Desktop GUI 的安装后完整重启仍由用户执行。
