# Boss投递本地手动安装说明（macOS arm64）

本文用于把 Boss投递从源码工程安装到本机 Codex/ChatGPT 和 Google Chrome。推荐使用 `baseline`：Chrome 扩展使用已验证基线，Native Host 使用现有签名的 arm64 二进制。

> 本流程会修改 Codex marketplace 配置、`~/.codex/plugins/cache`、Chrome NativeMessagingHosts 和 `chrome-native-hosts-v2.json`。Boss投递使用独立 Host `com.openai.codexextension.dev`，不会替换官方 `com.openai.codexextension`。

## 一、最短安装流程

### 1. 准备工程并构建

```bash
cd /Users/dmeck/project/boss-agent-work/develop

make setup
make baseline
make verify
```

主要输出：

```text
dist/baseline/marketplace/     Codex marketplace
dist/baseline/electron-app/    Electron Main 集成和手动 reconcile CLI
```

### 2. 注册 marketplace 并安装插件

```bash
BOSS_WORKSPACE="/Users/dmeck/project/boss-agent-work/develop"
CODEX_DATA_DIR="${CODEX_HOME:-/Users/dmeck/.codex}"
CODEX_CLI_BIN="$CODEX_DATA_DIR/plugins/.plugin-appserver/codex"

test -x "$CODEX_CLI_BIN"

if "$CODEX_CLI_BIN" plugin marketplace list | rg -q '^codex-chrome-automation-local[[:space:]]'; then
  "$CODEX_CLI_BIN" plugin marketplace remove codex-chrome-automation-local --json
fi

"$CODEX_CLI_BIN" plugin marketplace add "$BOSS_WORKSPACE/dist/baseline/marketplace" --json
"$CODEX_CLI_BIN" plugin add chrome-dev@codex-chrome-automation-local --json
```

安装结果应显示：

```text
pluginId: chrome-dev@codex-chrome-automation-local
version: 26.707.30751-standalone.3
```

Codex CLI 当前只负责复制插件。若正在运行的 Electron 宿主尚未接入本项目的 `onDidInstall` lifecycle，还需要执行下一步。

### 3. 初始化 Native Host

先只检查路径，不写用户配置：

```bash
BOSS_WORKSPACE="/Users/dmeck/project/boss-agent-work/develop"

node "$BOSS_WORKSPACE/dist/baseline/electron-app/bin/reconcile-native-host.mjs" \
  --dry-run \
  --json
```

确认输出中 `ready` 为 `true` 后执行：

```bash
node "$BOSS_WORKSPACE/dist/baseline/electron-app/bin/reconcile-native-host.mjs" --json
```

此命令会幂等完成：

- 把 `chrome-dev/latest` 指向当前安装版本；
- 写入 Google Chrome、Chromium 和 Chrome for Testing manifests；
- 写入 `extension-host-config.json`；
- 向共享目录和 `CODEX_HOME` 的 `chrome-native-hosts-v2.json` 添加 Boss投递 Runtime entry；
- 保留官方和其他插件的 registry entries。

### 4. 在 Chrome 加载扩展

1. 打开 [Google Chrome 扩展管理器](chrome://extensions/)。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择：

   ```text
   /Users/dmeck/project/boss-agent-work/develop/dist/baseline/marketplace/plugins/chrome-dev/chrome-extension
   ```

5. 确认名称为“Boss投递”，扩展 ID 为：

   ```text
   jigmpnbdhhempldjgegphdgkochgpagi
   ```

如果该扩展已经加载，且本次重新构建过 Chrome 扩展，请点击扩展卡片上的“重新加载”。Service Worker 不会自动采用磁盘上的新代码。

`make clean` 会删除 `dist/`。Chrome 仍引用该目录时，不要清理它；如果已经清理，先重新运行 `make baseline`，再在扩展管理器中重新加载。

## 二、安装前置条件

### 系统

- macOS arm64；使用 `uname -m` 应输出 `arm64`。
- Google Chrome 已安装。
- Codex Desktop 或 ChatGPT Desktop 已安装，并已生成 Codex 数据目录。

### 开发工具

```bash
git --version
node --version
npm --version
python3 --version
jq --version
rg --version
rsync --version
```

建议 Node.js 22 或更高版本。只有构建 `full-reconstructed` 时才需要 Rust：

```bash
rustc --version
cargo --version
```

## 三、选择构建档位

| 档位 | 命令 | Native Host | 用途 |
| --- | --- | --- | --- |
| `baseline` | `make baseline` | 当前签名 arm64 基线 | 推荐安装和回归验证 |
| `extension-dev` | `make extension-dev` | 当前签名 arm64 基线 | 修改 Chrome 扩展源码 |
| `full-reconstructed` | `make full-reconstructed` | Rust 语义重建版本 | 协议研究，不建议生产使用 |

切换档位时，将前述 marketplace 路径中的 `baseline` 替换为 `extension-dev` 或 `full-reconstructed`。

## 四、Runtime 路径无法自动识别时

### ChatGPT.app 当前布局

```bash
BOSS_WORKSPACE="/Users/dmeck/project/boss-agent-work/develop"

node "$BOSS_WORKSPACE/dist/baseline/electron-app/bin/reconcile-native-host.mjs" \
  --codex-home "/Users/dmeck/.codex" \
  --resources-path "/Applications/ChatGPT.app/Contents/Resources" \
  --codex-cli "/Users/dmeck/.codex/plugins/.plugin-appserver/codex" \
  --node "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
  --node-repl "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl" \
  --json
```

### Codex.app 参考布局

```bash
BOSS_WORKSPACE="/Users/dmeck/project/boss-agent-work/develop"

node "$BOSS_WORKSPACE/dist/baseline/electron-app/bin/reconcile-native-host.mjs" \
  --codex-home "/Users/dmeck/.codex" \
  --resources-path "/Applications/Codex.app/Contents/Resources" \
  --codex-cli "/Applications/Codex.app/Contents/Resources/codex" \
  --node "/Applications/Codex.app/Contents/Resources/node" \
  --node-repl "/Applications/Codex.app/Contents/Resources/node_repl" \
  --json
```

如插件 cache 中存在多个版本，可使用：

```bash
--version-root "/Users/dmeck/.codex/plugins/cache/codex-chrome-automation-local/chrome-dev/26.707.30751-standalone.3"
```

## 五、分层验证

```bash
CODEX_DATA_DIR="${CODEX_HOME:-/Users/dmeck/.codex}"
PLUGIN_ROOT="$CODEX_DATA_DIR/plugins/cache/codex-chrome-automation-local/chrome-dev/latest"

node "$PLUGIN_ROOT/scripts/check-extension-installed.js" --json
node "$PLUGIN_ROOT/scripts/check-native-host-manifest.js" --json
node "$PLUGIN_ROOT/scripts/verify-standalone.mjs" --live
pgrep -fl "$PLUGIN_ROOT/extension-host/macos/arm64/extension-host"
```

检查 Runtime registry：

```bash
jq '[.entries[] | select(.nativeHostNames[]? == "com.openai.codexextension.dev")]' \
  "$CODEX_DATA_DIR/chrome-native-hosts-v2.json"
```

状态含义：

| 状态 | 验收证据 |
| --- | --- |
| `extension-installed` | `check-extension-installed.js` 显示 installed/enabled |
| `manifest-valid` | `check-native-host-manifest.js` 显示 `correct: true` |
| `runtime-published` | registry 中存在 Boss投递 dev entry，路径全部有效 |
| `port-connected` | Chrome 实际启动 Boss投递 `extension-host`，或 Popup 显示 Connected |
| `browser-action-verified` | 新 node_repl 会话通过 Boss投递完成一次轻量页面读取 |

`manifest-valid` 不等于浏览器操作已经可用。最终验证应在新 node_repl 会话中加载 Boss投递 browser client，执行一次简单的标签页读取；如果返回 `Browser is not available: extension`，不要改用本地 Playwright 或 Selenium 伪装成功。

## 六、更新插件

```bash
cd /Users/dmeck/project/boss-agent-work/develop
git pull --ff-only
make baseline
make verify

BOSS_WORKSPACE="/Users/dmeck/project/boss-agent-work/develop"
CODEX_DATA_DIR="${CODEX_HOME:-/Users/dmeck/.codex}"
CODEX_CLI_BIN="$CODEX_DATA_DIR/plugins/.plugin-appserver/codex"

"$CODEX_CLI_BIN" plugin add chrome-dev@codex-chrome-automation-local --json
node "$BOSS_WORKSPACE/dist/baseline/electron-app/bin/reconcile-native-host.mjs" --json
```

如果扩展构建物发生变化，再到 `chrome://extensions` 点击“重新加载”。Native Host 或 registry 单独变化时通常不需要重新加载扩展，连接会按重试机制重新建立。

## 七、卸载与安全回滚

先停止可能仍在运行的 Boss投递 Host：

```bash
pkill -f '/codex-chrome-automation-local/chrome-dev/.*/extension-host' || true
```

移除插件：

```bash
CODEX_DATA_DIR="${CODEX_HOME:-/Users/dmeck/.codex}"
CODEX_CLI_BIN="$CODEX_DATA_DIR/plugins/.plugin-appserver/codex"

"$CODEX_CLI_BIN" plugin remove chrome-dev@codex-chrome-automation-local --json
```

然后在 `chrome://extensions` 中移除“Boss投递”。如需完全清理 Native Host，手工处理前必须核对目标 JSON 的 `name` 是 `com.openai.codexextension.dev`，且 `allowed_origins` 包含 Boss投递扩展 ID。不要删除：

```text
com.openai.codexextension.json
```

它属于官方 Chrome 集成。registry 清理也只能删除同时匹配以下两个条件的 entry：

```text
extensionIds 包含 jigmpnbdhhempldjgegphdgkochgpagi
nativeHostNames 包含 com.openai.codexextension.dev
```

## 八、常见故障

### `ready: false`

查看 `missing` 数组，并通过 `--resources-path`、`--codex-cli`、`--node` 和 `--node-repl` 显式提供真实路径。

### manifest 正确但没有 Host 进程

确认 Chrome 正在运行、扩展已启用，并在 `chrome://extensions` 重新加载 Boss投递。等待连接重试后再检查进程。

### `latest` 指向旧版本

重新运行 reconcile CLI。它会替换悬空或过期 symlink；如果 `latest` 是普通目录，会先备份为 `latest.backup-<时间戳>`，不会直接删除。

### 安装后每条命令固定等待约 30 秒

这属于 browser-client/扩展控制链路问题，不是 manifest 安装问题。使用 `chrome-plugin-debug` 或 `chrome-plugin-fix-delivery` 继续诊断，部署扩展修复后必须 reload Chrome 扩展。
