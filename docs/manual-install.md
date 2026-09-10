# Boss投递本地手动安装说明（macOS arm64）

本文用于把 Boss投递从源码工程安装到本机 Codex/ChatGPT 和 Google Chrome。推荐使用 `baseline`：Chrome 扩展使用已验证基线，Native Host 使用现有签名的 arm64 二进制。

当前版本、制品摘要、源码映射和发布验收清单见 [Codex 插件发布与使用说明](codex-plugin-release.md)。

> 本流程会修改 Codex marketplace 配置、`~/.codex/plugins/cache`、Chrome NativeMessagingHosts 和 `chrome-native-hosts-v2.json`。Boss投递使用独立 Host `com.openai.codexextension.dev`，不会替换官方 `com.openai.codexextension`。

## 零、准备配套仓库并运行 Prompt 任务

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

### 5. 可选：安装 agent-browser-loader

[agent-browser-loader](https://github.com/glide-the/agent-browser-loader) 是 `agent-browser` 的配套本地插件工程，不是 Boss投递 Chrome Extension 的组成部分，也不是 `@chrome-dev` 连接失败时的自动降级方案。它适合明确选择 `agent-browser` 的独立任务。方案背景和反自动化检测取舍见公众号文章[《你有海投简历的想法么？agent-browser：可以帮你》](https://mp.weixin.qq.com/s/zwlvnz4mDSyPdXYHGAnjWg)。

两条链路的入口和策略互不替代：

| 链路 | 调用入口 | 浏览器连接 | 策略归属 |
| --- | --- | --- | --- |
| Boss投递 | Codex 中的 `@chrome-dev` | Browser Client → Native Host → Boss投递扩展 | 本工程 `src/browser-client` 的 Site Status/Origin 策略 |
| agent-browser-loader | `agent-browser` CLI | Plugin/Provider → 本地 Chrome 或 CDP | `agent-browser.json`、Provider 配置和 `agent-browser` 自身策略 |

#### 5.1 安装前检查

插件源码和构建统一使用 Bun。`agent-browser` CLI 是独立上游程序，可按其官方方式安装；macOS 推荐 Homebrew：

```bash
bun --version
node --version

brew install agent-browser
agent-browser --version
```

如果本机没有可被识别的 Chrome，或希望使用 Chrome for Testing，再执行：

```bash
agent-browser install
```

已经安装 `agent-browser` 时不要重复安装，可用下面的命令升级：

```bash
agent-browser upgrade
```

#### 5.2 下载并构建两个插件

首次下载到固定路径：

```bash
git clone git@github.com:glide-the/agent-browser-loader.git \
  /Users/dmeck/project/agent-browser-loader
```

使用仓库声明的 Bun 构建命令分别生成两个 Node ESM 插件：

```bash
cd /Users/dmeck/project/agent-browser-loader/plugins/agent-browser-plugin-stealth
bun run build

cd /Users/dmeck/project/agent-browser-loader/plugins/agent-browser-plugin-userprofile-browser
bun run build

cd /Users/dmeck/project/agent-browser-loader
test -s plugins/agent-browser-plugin-stealth/dist/index.js
test -s plugins/agent-browser-plugin-userprofile-browser/dist/index.js
```

两个检查都应以状态码 `0` 结束。仓库根目录的 `agent-browser.json` 已把它们注册为：

- `stealth`：`launch.mutate`，自动作用于普通的 `agent-browser` 本地启动；
- `userprofile-browser`：`browser.provider`，通过 `--provider userprofile-browser` 显式启用。

`agent-browser.json` 中的插件脚本是相对路径。运行下面所有 `agent-browser` 命令前，应先进入 `/Users/dmeck/project/agent-browser-loader`；从其他工作目录启动会找不到插件构建物。

#### 5.3 配置隔离的 Chrome Profile 副本

在 Chrome 地址栏打开 `chrome://version`，查看“个人资料路径”。路径最后一段通常是 `Default`、`Profile 1` 或 `Profile 2`，把它填入 `profileDirectory`。

创建本地文件：

```text
/Users/dmeck/project/agent-browser-loader/.agent-browser/userprofile.config.json
```

这是仅供本机使用的配置。创建前应在 `/Users/dmeck/project/agent-browser-loader/.git/info/exclude` 中加入一行 `.agent-browser/userprofile.config.json`，降低误提交风险。

macOS 示例：

```json
{
  "userDataDir": "/Users/dmeck/Library/Application Support/Google/Chrome",
  "profileDirectory": "Default",
  "debugDir": "/Users/dmeck/Library/Application Support/Google/ChromeRemoteDebug",
  "statePath": "/Users/dmeck/.agent-browser/agent-browser-loader-state.json"
}
```

先创建本地状态目录：

```bash
mkdir -p /Users/dmeck/.agent-browser
```

这里必须让 `debugDir` 与真实的 `userDataDir` 不同。Provider 会把登录态 Profile 同步到 `debugDir`，并且只从副本启动 Chrome，不能让自动化进程直接使用正在运行的真实 Profile。第一次同步前完全退出 Chrome 可以得到更一致的副本；虽然实现会排除锁、日志、journal 和 cache 文件，但在 Chrome 正在写入时复制仍可能取得跨文件时间点不一致的数据。

`userprofile.config.json`、状态文件、会话 registry 和 `ChromeRemoteDebug` 目录可能暴露本机路径或包含 Cookies、登录会话等敏感数据，不得提交到 Git、上传或写入任务日志。上面的 `statePath` 特意放在仓库外，避免更新仓库中已有的示例状态文件。

#### 5.4 检查插件注册

必须从仓库根目录运行：

```bash
cd /Users/dmeck/project/agent-browser-loader

agent-browser plugin list
agent-browser plugin show stealth
agent-browser plugin show userprofile-browser
```

结果应分别显示 `launch.mutate` 和 `browser.provider` capability。如果列表为空，先检查当前目录是否正确、`agent-browser.json` 是否存在，以及两个 `dist/index.js` 是否已构建。

#### 5.5 进行无副作用冒烟验证

先使用 `example.com`，不要把首次验证直接放在 BOSS 直聘或其他真实业务网站。

验证用户 Profile Provider：

```bash
cd /Users/dmeck/project/agent-browser-loader

agent-browser --session loader-provider-smoke \
  --provider userprofile-browser \
  open https://example.com
agent-browser --session loader-provider-smoke get url
agent-browser --session loader-provider-smoke snapshot
agent-browser --session loader-provider-smoke close
```

首次 `open` 会同步 Profile，因此耗时明显长于后续启动。Provider 返回的浏览器应使用 `ChromeRemoteDebug` 副本；真实 Chrome Profile 不应成为启动目录。

再验证普通本地启动的 `stealth` 修改器：

```bash
cd /Users/dmeck/project/agent-browser-loader

agent-browser --session loader-stealth-smoke open https://example.com
agent-browser --session loader-stealth-smoke get url
agent-browser --session loader-stealth-smoke close
```

`launch.mutate` 只影响普通本地 launch，不影响 `--cdp`、`--auto-connect` 或其他 `browser.provider` 启动。它提供通用的最小兼容处理，不保证绕过任何网站不断变化的检测机制。

#### 5.6 更新与重新构建

```bash
git -C /Users/dmeck/project/agent-browser-loader status --short
git -C /Users/dmeck/project/agent-browser-loader pull --ff-only

cd /Users/dmeck/project/agent-browser-loader/plugins/agent-browser-plugin-stealth
bun run build

cd /Users/dmeck/project/agent-browser-loader/plugins/agent-browser-plugin-userprofile-browser
bun run build
```

如果 `git status --short` 显示本地修改，先确认修改来源，不要用 reset 或 checkout 覆盖。更新 TypeScript、Profile 规则或扩展脚本后，需要重新构建插件；修改 `stealth-extension/profiles/*.json` 后，还需要重启由该链路启动的 Chrome，或重新加载对应未打包扩展。

#### 5.7 停止、清理与限制

停止全部 `agent-browser` 会话：

```bash
agent-browser close --all
```

确认没有仍在使用副本的 Chrome 进程后，才可以清理 `debugDir`。该目录包含登录态副本，建议通过 Finder 移到废纸篓；不要对未核实的变量、通配符、用户主目录或真实 Chrome `userDataDir` 执行递归删除。

还需注意：

- 使用真实登录态、第三方扩展或 API Key 前，确认目标网站规则和授权范围；
- 不要在 `agent-browser.json`、本地配置或日志中保存第三方扩展 API Key；
- `agent-browser --allowed-domains` 与 Chrome Profile、既有 CDP 会话及部分 Provider 模式存在兼容限制；这与 Boss投递的 Origin 策略不是同一个机制；
- Boss Prompt 明确要求 `@chrome-dev` 时，`agent-browser-loader` 即使安装成功也不得作为隐式替代路径。

常见错误：

| 错误或现象 | 检查项 |
| --- | --- |
| 插件未出现在 `plugin list` | 当前目录、根目录 `agent-browser.json`、两个 `dist/index.js` |
| `profile_not_found` | `userDataDir` 和从 `chrome://version` 取得的 `profileDirectory` |
| `chrome_not_found` | Google Chrome 安装路径，或按提示显式设置 `executablePath` |
| `launch_failed` | Chrome 是否仍占用副本、`debugDir` 权限、Remote Debug 启动日志 |
| Boss Prompt 仍提示 `@chrome-dev` 不可用 | 应修复 Boss投递 Extension/Native Host；安装本项目不会修复该链路 |

## 一、最短安装流程

### 1. 准备工程并构建

```bash
cd /Users/dmeck/project/boss-agent-work/develop

make setup
make baseline
make verify
```

`make setup` 除了初始化 `.venv`，还会把项目维护的六个 BOSS/Chrome 技能软连接到 `$AGENTS_HOME/skills`（默认 `~/.agents/skills`），并把 `boss-send-resume-button`、`chrome-file-upload-patterns` 软连接到 `$CODEX_HOME/skills`（默认 `~/.codex/skills`）。只需要重新建立或检查软连接时可运行：

```bash
cd /Users/dmeck/project/boss-agent-work/develop
make install-skills
./scripts/install-project-skills.sh --check
```

项目目录是可维护源码，用户技能目录只保存软连接。通过任一链接编辑时，改动会直接进入项目工作区并出现在 Git 状态中。

首次迁移时，安装器只会自动替换内容与项目完全一致的实体目录；检测到差异会停止，要求先把用户目录改动合并回项目。完成审核后可执行 `./scripts/install-project-skills.sh --migrate-existing`，旧目录会移动到对应的 `$AGENTS_HOME/backups/project-skill-links/` 或 `$CODEX_HOME/backups/project-skill-links/`，不会被直接删除。

`make baseline` 会先调用 `make browser-client`。规范要求它只从 `components/codex-plugin/src/browser-client` 使用锁定的 Bun 构建全部第一方脚本和配置；差分失败时不会继续组装 marketplace。Browser Client 的权威源码、生成物和仍保留的兼容 kernel 边界见 [Codex 插件发布与使用说明](codex-plugin-release.md#2-制品与源码映射)，不得把过渡生成物描述为上游官方源码的完整恢复。

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

"$CODEX_CLI_BIN" plugin marketplace add "$BOSS_WORKSPACE/dist/baseline/marketplace" --json
"$CODEX_CLI_BIN" plugin add chrome-dev@codex-chrome-automation-local --json
```

安装结果应显示：

```text
pluginId: chrome-dev@codex-chrome-automation-local
version: 26.707.30751-standalone.11
```

Codex CLI 负责安装插件并更新启用记录，不负责本项目的 Native Host 注册。若正在运行的 Electron 宿主尚未接入本项目的 `onDidInstall` lifecycle，还需要执行下一步。

### 3. 初始化 Native Host

先检查路径、用户配置、个人预期指纹与宿主接口，不写用户配置。必须使用 Bun。新版个人 Browser Client 通过插件自带 `boss_repl` 调用独立的 `boss_browser` trusted service；dry-run 会执行真实授权 ping，旧共享 SHA allowlist 不参与初始化：

```bash
BOSS_WORKSPACE="/Users/dmeck/project/boss-agent-work/develop"

bun "$BOSS_WORKSPACE/components/electron-app/bin/reconcile-native-host.mjs" \
  --dry-run \
  --json
```

只有输出 `ready=true` 才可以执行注册；这仍不表示当前会话已经获得信任或连接成功：

```bash
bun "$BOSS_WORKSPACE/components/electron-app/bin/reconcile-native-host.mjs" --json
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

bun "$BOSS_WORKSPACE/components/electron-app/bin/reconcile-native-host.mjs" \
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

bun "$BOSS_WORKSPACE/components/electron-app/bin/reconcile-native-host.mjs" \
  --codex-home "/Users/dmeck/.codex" \
  --resources-path "/Applications/Codex.app/Contents/Resources" \
  --codex-cli "/Applications/Codex.app/Contents/Resources/codex" \
  --node "/Applications/Codex.app/Contents/Resources/node" \
  --node-repl "/Applications/Codex.app/Contents/Resources/node_repl" \
  --json
```

如插件 cache 中存在多个版本，先解析当前 `latest`，不要把版本号写死在脚本或任务中：

```bash
CODEX_DATA_DIR="${CODEX_HOME:-$HOME/.codex}"
PLUGIN_VERSION_ROOT="$(readlink "$CODEX_DATA_DIR/plugins/cache/codex-chrome-automation-local/chrome-dev/latest")"

bun "$BOSS_WORKSPACE/components/electron-app/bin/reconcile-native-host.mjs" \
  --version-root "$PLUGIN_VERSION_ROOT" \
  --dry-run \
  --json
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
| `service-authorized` | `effectiveTrust=isolated-service-authorized`，动态 ping 已确认 `boss_browser` 与受信 worker 的 `nativePipe` |
| `browser-action-verified` | Desktop 重新加载插件后的 `boss_repl` 新会话通过 Boss投递完成一次轻量页面读取 |

`manifest-valid` 和 `service-authorized` 都不等于 Chrome 端已经连接。最终验证应在 Desktop 重新加载插件后的 `boss_repl` 会话中加载 Boss投递 Browser Client，执行一次简单的标签页读取；如果返回 `Browser is not available: extension`，按 Native Host/扩展链路排查，不把其他浏览器机制的结果当成成功。

从 `.10` 升级到 `.11` 后，完整退出并重新启动 Desktop，再创建新任务，使稳定 launcher 声明进入进程缓存。`.11` 的声明不保存版本目录 `cwd`，而是在每次启动 `boss_repl` 时通过 `CODEX_HOME`（默认 `~/.codex`）解析 `chrome-dev/latest`。`codex mcp list --json` 能看到 `boss_repl` 只证明磁盘配置已被 CLI 解析，不能代替新任务的工具发现验收。

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
bun "$BOSS_WORKSPACE/components/electron-app/bin/reconcile-native-host.mjs" --json
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

### 出现 `ERROR [Statsig] ... ab.chatgpt.com/v1/initialize`

`26.707.30751-standalone.10` 已从个人 Browser Client 启动链删除 Statsig、ChatGPT identity 和 Sentry 远程初始化。出现该日志说明 Desktop 仍加载 `.9` 或更早的插件快照。检查 `chrome-dev@codex-chrome-automation-local` 的安装版本及 `latest` 指向，完整退出并重新启动 Desktop 后创建新任务。不要把该请求失败解释为 Chrome Extension、Native Host 或信任校验失败。

## 个人指纹配置与信任边界（2026-09-07）

`NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` 是旧版宿主的共享 Browser Client allowlist，不是个人插件身份，也不是操作系统变量。本项目不追加或覆盖该变量。个人插件通过 `.mcp.json` 启动独立 `boss_repl`，并只在该子进程注册 `boss_browser`；启动器会删除继承的旧 SHA 变量，不修改官方 `browser` 服务。

个人插件只读取专用变量 `BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256`，作为受审查 Browser Client 文件的预期 SHA-256；默认未设置。优先级为 `--expected-browser-client-sha256` 参数、该环境变量、未指定。它仅用于完整性比较，不能授予宿主信任，也不会被传递为宿主 SHA256S 信任列表。请将经过审查的发行产物哈希保存在自己的终端或运行命令环境中，不要放进宿主的全局 shell_environment_policy。

```bash
BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256="<受审查产物的64位SHA-256>" \
  bun components/electron-app/bin/reconcile-native-host.mjs --dry-run --json
bun components/electron-app/bin/reconcile-native-host.mjs --codex-home /absolute/personal-codex --dry-run --json
```

命令逐项报告 `PLUGIN_NOT_INSTALLED`、`PLUGIN_DISABLED`、`MCP_TOOL_APPROVAL_REQUIRED`、`MCP_TOOL_APPROVAL_CONFLICT`、`MCP_TOOL_DISABLED`、`MCP_SERVER_DISABLED`、`PLUGIN_UNTRUSTED`、`FINGERPRINT_MISMATCH`、`USER_CONFIG_ERROR`、`INVALID_ENVIRONMENT`、`CONFIG_CONFLICT`、`POLICY_REVIEW_REQUIRED`、`POLICY_REJECTED`、`RUNTIME_INCOMPATIBLE` 或 `RUNTIME_UNVERIFIED`。只有动态 ping 同时验证服务名、随机 nonce、协议版本和 `nativePipe=true` 时，`effectiveTrust` 才为 `isolated-service-authorized`。托管配置存在时交由宿主确认。

通过前置检查后，初始化器先把 `config.toml` 与 Native Host 目标备份至所选 `CODEX_HOME/backups/personal-plugin-native-host-*/snapshot.json`。若个人工具尚未授权，它使用 Codex App Server 的 `config/read` 和带 `expectedVersion` 的 `config/batchWrite`，只 upsert `plugins."chrome-dev@codex-chrome-automation-local".mcp_servers.boss_repl.tools.js.approval_mode = "approve"`，随后注册 Host。其他配置和历史 SHA 变量保持不变；显式非 `approve`、server/tool 禁用和企业覆盖不会被替换。返回 `nativeHostRegistered` 和 `connectionVerified=false`。

```bash
bun components/electron-app/bin/rollback-native-host.mjs /absolute/path/to/snapshot.json
```

回滚前检查所有目标是否在初始化后被其他进程修改，冲突时拒绝覆盖。初始化失败也会密封快照，供人工恢复本轮 `config.toml` 和 Host 目标。直接 Electron 生命周期 API 仍仅注册 Native Host；完整的个人授权流程应使用 reconcile CLI。

设计、证据与完整限制见 [personal-plugin-trust-design.md](personal-plugin-trust-design.md)。新启动的临时 Codex 任务已发现 `boss_repl` 并完成真实 Chrome 标签页只读调用；当前 Desktop GUI 仍需完整重启后确认工具目录刷新。
