# 个人插件身份与信任配置修复结果

日期：2026-09-07
工程：`/Users/dmeck/project/boss-agent-work/develop`

## 结果

个人插件已升级并安装为 `chrome-dev@codex-chrome-automation-local` `26.707.30751-standalone.7`。`latest` 已指向 `.7`，Native Host 已按当前用户路径注册；最终版本的两次实际初始化分别返回 `replace-symlink` 与 `no-op`。新版 Browser Client 不再依赖旧 SHA allowlist，而是通过插件自带 `boss_repl` 调用独立 `boss_browser` trusted service。

真实宿主授权握手已通过：当前 Desktop `node_repl` 动态加载该服务，返回匹配 nonce、`service=boss_browser`、`protocolVersion=1`、`nativePipeAvailable=true`；preflight 因而报告 `effectiveTrust=isolated-service-authorized`。这证明个人服务获得当前运行时能力，不能替代完整 Chrome 连接验收。

Desktop 没有被自动关闭。当前任务是在安装前启动的，无法热加载刚新增的 `boss_repl` MCP。一次手工标签页探针因没有 Desktop 真实 `session_id/turn_id` 元数据，在 Chrome 调用前被安全策略拒绝；未继续伪造来源。需要完整重启 Desktop，并从真实新任务执行轻量标签页读取后，才能宣称连接恢复。

## 根因判断

- confirmed：修改前插件已经是用户级安装，不存在占用系统级插件安装目录的证据。
- confirmed：`9599a8a2520d1e064e3965e4cbf82240f3179cf935ab355dca3f96429c52e6e6` 是旧 `.4` `browser-client.mjs` 的文件 SHA-256，不是插件身份、扩展 ID、Host 名称或签名。
- confirmed：`NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` 是旧版 `node_repl` 的 Browser Client 文件哈希 allowlist 接口。它可存在于进程环境或用户配置的 shell 环境策略中，但不是操作系统级插件变量。
- confirmed：当前 `node_repl` 不再识别该旧变量。给临时子进程设置正确旧哈希后，旧客户端仍得到 `nativePipe=false`、`rpc=true`。
- confirmed：修改前失败发生在旧 Browser Client 初始化检查，尚未到 Chrome 扩展握手。
- confirmed：根因是旧 `nativePipe` 客户端契约与当前 trusted-service/RPC 运行时不兼容。
- confirmed：修复采用个人 `boss_repl` / `boss_browser` 命名空间，没有覆盖官方 `browser` 服务或更改 Native Host 协议。

“占用系统指纹”不成立；“个人插件不该复用旧共享信任变量”成立。本次按后者完成隔离。

## 旧版初始化代码

历史链路位于：

- `.../src/runtime/.vite/build/main-BJ6Uf5yA.ts:482`：旧 Browser Client 哈希常量。
- 同文件约 `1555`、`1592` 行：向 Browser Native REPL 配置传入哈希数组。
- `.../src/main/browser/browser-native-repl-config.ts:65-66`：连接为逗号字符串并写入 `NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S`。

完整绝对路径和证据边界见 [设计稿](personal-plugin-trust-design.md)。归档中没有旧 `node_repl` 校验器本体，因此内部比较实现仍 unresolved。

## 实现

- `components/codex-plugin/.mcp.json`：声明插件私有 `boss_repl` MCP。
- `components/codex-plugin/src/browser-client/runtime/trusted-service.ts`：构造隔离启动环境、删除子进程旧 SHA 变量、注册 `boss_browser`、执行动态授权 ping。
- `components/codex-plugin/src/browser-client/browser-service.ts`：trusted-service 的 `ping/setup/execute` 入口。
- `components/codex-plugin/src/browser-client/scripts/launch-browser-service.ts`：由 Bun 构建的 Node 兼容 launcher 与 `--probe`；MCP 使用 Desktop bundled Node 启动，不依赖 GUI PATH。
- `recovery/browser-client/reconstruction/scripts/materialize-browser-runtime.mjs`：将客户端模式切换为 `nodeRepl.rpc("boss_browser")`，服务模式保留 privileged `nativePipe`。
- `components/codex-plugin/src/browser-client/build/{inventory,verify,deploy}.ts`：生成三项 runtime artifact，验证 client/service roundtrip，保持 `scripts-bak` 唯一基线可回滚。
- `components/electron-app/src/plugin-trust-preflight.mjs`：验证安装身份、可选发布摘要、当前运行时 marker 和真实服务握手。
- `components/electron-app/src/manual-install-environment.mjs`、`native-host-backup.mjs` 与两个 CLI：写入前二次校验、备份、幂等注册和受保护回滚。
- 插件 skill、安装手册、生命周期文档和验证脚本已改为 `boss_repl`，不再指导使用共享 `node_repl`。

生成物：

- `components/codex-plugin/scripts/browser-client.mjs`
- `components/codex-plugin/scripts/browser-service.mjs`
- `components/codex-plugin/scripts/launch-browser-service.mjs`

`scripts-bak` 未被覆盖；修改前 immutable digest 仍为 `85d1bc4f7d456ef75eceab7df6159ebfdfce23de0af51175ec9ba2dc9e579964`（344 文件）。

## 环境变量

| 名称 | 用途 | 默认/优先级 |
| --- | --- | --- |
| `CODEX_HOME` | 用户配置与插件缓存根 | `--codex-home` > 环境 > `~/.codex` |
| `BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256` | 与受审查发布产物比较完整性；不授予信任 | `--expected-browser-client-sha256` > 环境 > 未设置 |
| `BOSS_PLUGIN_NODE_REPL_PATH` | 非标准 Desktop 的 `node_repl` 绝对路径 | 默认自动发现 ChatGPT/Codex Resources |
| `BOSS_PLUGIN_NODE_PATH` | 与所选 Desktop 配套 Node 的绝对路径 | 默认从 Resources 推导 |

`NODE_REPL_TRUSTED_SERVICES` 由 launcher 仅为自己的子进程生成，只有 `boss_browser`。`NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` 不作为个人变量；launcher 删除其子进程继承值，reconcile 只读诊断，不修改用户现有值。

当前发布摘要：

```text
browser-client.mjs          d3a46310e170cd04943dc1a2c91b46adfdb1d099d473066235ba04123df0626f
browser-service.mjs         051a35acf9253f847d1814fcb1c393fbd8c1e26468d83b94fe532395d6efd805
launch-browser-service.mjs 0c6a9d6ed3072a489e068b7279a4427bcc87a19a54d7474ae380bbc286fd56ca
```

## 安装、验证与回滚

从工程根目录执行：

```bash
CODEX_CLI="$HOME/.codex/plugins/.plugin-appserver/codex"

"$CODEX_CLI" plugin marketplace add \
  /Users/dmeck/project/boss-agent-work/develop/dist/baseline/marketplace --json
"$CODEX_CLI" plugin add chrome-dev@codex-chrome-automation-local --json

BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256=d3a46310e170cd04943dc1a2c91b46adfdb1d099d473066235ba04123df0626f \
  bun components/electron-app/bin/reconcile-native-host.mjs --dry-run --json

BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256=d3a46310e170cd04943dc1a2c91b46adfdb1d099d473066235ba04123df0626f \
  bun components/electron-app/bin/reconcile-native-host.mjs --json
```

源码/发行验证：

```bash
make verify
make package
cargo test --manifest-path components/native-host/Cargo.toml
```

本机配置备份：

```text
/Users/dmeck/.codex/backups/personal-plugin-install-20260907-standalone-5/config.toml.before
```

首次 Native Host 注册快照：

```text
/Users/dmeck/.codex/backups/personal-plugin-native-host-b3ebc709-11f7-4045-b672-cdfab011351a/snapshot.json
```

如需回滚首次 Host 注册：

```bash
bun components/electron-app/bin/rollback-native-host.mjs \
  /Users/dmeck/.codex/backups/personal-plugin-native-host-b3ebc709-11f7-4045-b672-cdfab011351a/snapshot.json
```

回滚会在目标随后发生变化时拒绝覆盖。恢复 `config.toml.before` 会同时撤销官方 CLI 后新增的其他配置，必须先人工审查 diff；本轮不自动执行该覆盖。

## 本机配置变化

- 官方 CLI 将个人 marketplace 的旧 `last_updated` 字段移除，source 与 enabled 记录保持正确。
- Desktop 同期新增了一个无关 project trust 记录，初始化器保留了它。
- 旧 `shell_environment_policy.set.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` 的两个历史值原样保留；个人服务不会继承它。
- Native Host manifest 指向 `chrome-dev/latest/extension-host/...`，allowed origin 仍为个人扩展 ID。
- Application Support registry 从原有 24 项保留并新增/更新个人 entry，总计 25 项；没有删除官方或其他插件 entry。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| Browser canonical build/typecheck/unit | 通过；33 项测试，15 项 canonical artifact |
| client → `boss_browser` → service roundtrip | 通过，`pass-via-isolated-boss-browser-service` |
| 真实 node_repl 动态授权 ping | 通过，`nativePipeAvailable=true` |
| Finder 风格受限 PATH + bundled Node | 通过；PATH 仅 `/usr/bin:/bin` 时授权 ping 成功 |
| Electron tests | 16/16 通过 |
| 临时 CODEX_HOME 首次/重复初始化 | 通过；幂等、config 不变、官方 fixture 保留、回滚成功 |
| 实际用户级最终版本第一次/第二次初始化 | 通过；`replace-symlink` / `no-op` |
| Chrome Extension typecheck/build | 通过 |
| Native Host Rust tests | 10/10 通过 |
| baseline / extension-dev / full-reconstructed | 全部验证并打包成功 |
| 完整重启后的 `boss_repl` 工具发现 | 未验证 |
| 真实 Chrome 标签页读取 | 未验证；缺少真实 Desktop turn metadata 的外部探针在 Chrome 调用前被拒绝 |

发行包：

```text
artifacts/boss-delivery-baseline.tar.gz           5587f981bf572f58ab66d850df8789f070586f2d38d937bb2969a2076d7ba9a5
artifacts/boss-delivery-extension-dev.tar.gz      2fd1fdc08dd96d80280513397734d02a2345c0c9b6c6dc591ef596b0b6b06a21
artifacts/boss-delivery-full-reconstructed.tar.gz 7633a4fb5b839ac9989aed0bfc5d81fd1b7fa2708b75e2e9d2bf34bf0c21bb34
```

## 剩余状态

- confirmed：个人插件、个人 trusted service 和用户级 Native Host 均已落地；旧 SHA 变量不参与个人初始化。
- confirmed：服务授权与 privileged pipe 已由当前运行时动态证明。
- inferred：完整重启后 Desktop 会加载插件新增的 `boss_repl`；仍需真实任务验证工具发现。
- unresolved：Chrome 扩展此刻的在线连接状态；远程企业策略；Windows HKCU 完整回滚。

源码发布、提交和 PR 状态由 [Codex 插件发布与使用说明](codex-plugin-release.md) 及仓库历史记录追踪。
