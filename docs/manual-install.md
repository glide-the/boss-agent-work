# Boss投递本地手动安装说明（macOS arm64）

本文用于把 Boss投递从源码工程安装到本机 Codex/ChatGPT 和 Google Chrome。推荐使用 `baseline`：Chrome 扩展使用已验证基线，Native Host 使用现有签名的 arm64 二进制。

> 本流程会修改 Codex marketplace 配置、`~/.codex/plugins/cache`、Chrome NativeMessagingHosts 和 `chrome-native-hosts-v2.json`。Boss投递使用独立 Host `com.openai.codexextension.dev`，不会替换官方 `com.openai.codexextension`。

## 零、准备任务仓库并运行 Prompt 任务

Boss投递负责控制 Chrome；实际的 Prompt 任务、辅助脚本、配置和任务数据位于独立仓库 [boss-agent-run-job](https://github.com/glide-the/boss-agent-run-job)。运行任务前，必须先把它下载到固定路径。

### 1. 首次下载

```bash
mkdir -p /Users/dmeck/project
git clone git@github.com:glide-the/boss-agent-run-job.git \
  /Users/dmeck/project/boss-agent

cd /Users/dmeck/project/boss-agent
bun install
```

### 2. 更新已有仓库

如果该目录已经存在，不要重复克隆。先确认没有未提交修改，再进行快进更新：

```bash
git -C /Users/dmeck/project/boss-agent status --short
git -C /Users/dmeck/project/boss-agent pull --ff-only
cd /Users/dmeck/project/boss-agent
bun install
```

之后在 Codex 中打开 `/Users/dmeck/project/boss-agent` 作为任务工作目录。三个 Prompt 会读取这个项目中的脚本、配置、进度文件和简历上下文。

### 3. 确认 Prompt 任务包

任务包位于 `/Users/dmeck/project/boss-agent/docs/`。每个文件都是外层 ZIP，里面还有一个 `Part-1.zip`，真正的 Prompt 是内层 Markdown；让 Codex 完整解压并读取，不要只看 ZIP 文件名。

推荐按以下顺序执行：

| 顺序 | Prompt 任务 | 文件 |
| --- | --- | --- |
| 1 | 简历投递批量处理 | `docs/9cd6133d-45d1-4184-9981-bacce2685449_ExportBlock-c242f613-5ade-46be-add3-3777d639d352.zip` |
| 2 | 与 BOSS 沟通获得面试机会 | `docs/56352147-341a-4d7d-97d1-a56e69e93f9b_ExportBlock-ac15ed3a-0e59-466f-8e8d-b532cff91020.zip` |
| 3 | 沟通进度数据摘要收集到飞书 | `docs/0bdbbc7c-30c4-4794-8fbc-49075ee96088_ExportBlock-d2fe6b20-1623-40bf-9bcb-263dd0f4ad19.zip` |

### 4. 在 Codex 中启动任务

新建 Codex 任务，使用下面的启动 Prompt，并替换任务包路径：

```text
工作目录使用 /Users/dmeck/project/boss-agent。

读取指定的 Prompt 任务包：
/Users/dmeck/project/boss-agent/docs/<任务包文件名>.zip

这个外层 ZIP 中包含 Part-1.zip。请继续读取内层 ZIP 中的 Markdown，完整理解其中的目标、工具约束、每轮规划协议、进度记录和停止条件。

先向我汇总本任务将进行的浏览器操作、消息发送、简历投递、日历或飞书写入等外部动作。得到我的确认后，再严格使用 Boss投递（@chrome-dev）执行；如果 Boss投递未连接，立即停止，不得改用 Playwright、agent-browser 或其他浏览器工具。
```

这些 Prompt 会产生真实的岗位沟通、简历投递、日历或飞书数据写入。首次运行建议先检查任务正文和当前登录账号，再明确允许执行的动作与数量。

`boss-agent-run-job` 中也包含 Bun/agent-browser 轨迹脚本，但它们不是这三个 Prompt 任务的浏览器替代入口。三个任务已经明确要求使用 Boss投递 `@chrome-dev`；连接失败时必须停止。

## 一、最短安装流程

### 1. 准备工程并构建

```bash
cd /Users/dmeck/project/boss-agent-work/develop

make setup
make baseline
make verify
```

`make baseline` 会先调用 `make browser-client`。规范要求它只从 `components/codex-plugin/src/browser-client` 使用锁定的 Bun 构建全部第一方脚本和配置；差分失败时不会继续组装 marketplace。2026-08-18 复审发现旧实现仍从 `tools/browser-client-recovery` 嵌入基线 bundle，迁移完成前不得把旧构建称为完整源码恢复。

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
version: 26.707.30751-standalone.4
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

## 二、Site Status 配置（通常不需要）

Site Status 和 Origin 授权现在使用同一份源码策略配置，不再在安装手册中分别维护。当前两者均关闭；正常安装不需要设置环境变量。

完整配置、兼容环境变量、安全边界、开发启用步骤和回滚方法统一见 [Browser Client 策略配置（Site Status 与 Origin）](browser-client-security-policy-config.md)。

## 三、安装前置条件

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

## 四、选择构建档位

| 档位 | 命令 | Native Host | 用途 |
| --- | --- | --- | --- |
| `baseline` | `make baseline` | 当前签名 arm64 基线 | 推荐安装和回归验证 |
| `extension-dev` | `make extension-dev` | 当前签名 arm64 基线 | 修改 Chrome 扩展源码 |
| `full-reconstructed` | `make full-reconstructed` | Rust 语义重建版本 | 协议研究，不建议生产使用 |

切换档位时，将前述 marketplace 路径中的 `baseline` 替换为 `extension-dev` 或 `full-reconstructed`。

## 五、Runtime 路径无法自动识别时

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
--version-root "/Users/dmeck/.codex/plugins/cache/codex-chrome-automation-local/chrome-dev/26.707.30751-standalone.4"
```

## 六、分层验证

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

## 七、更新插件

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

## 八、卸载与安全回滚

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

## 九、常见故障

### `ready: false`

查看 `missing` 数组，并通过 `--resources-path`、`--codex-cli`、`--node` 和 `--node-repl` 显式提供真实路径。

### manifest 正确但没有 Host 进程

确认 Chrome 正在运行、扩展已启用，并在 `chrome://extensions` 重新加载 Boss投递。等待连接重试后再检查进程。

### `latest` 指向旧版本

重新运行 reconcile CLI。它会替换悬空或过期 symlink；如果 `latest` 是普通目录，会先备份为 `latest.backup-<时间戳>`，不会直接删除。

### 安装后每条命令固定等待约 30 秒

这属于 browser-client/扩展控制链路问题，不是 manifest 安装问题。使用 `chrome-plugin-debug` 或 `chrome-plugin-fix-delivery` 继续诊断，部署扩展修复后必须 reload Chrome 扩展。
