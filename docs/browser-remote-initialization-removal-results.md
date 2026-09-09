# 个人 Browser Client 远程初始化移除结果

日期：2026-09-09

版本：`chrome-dev@codex-chrome-automation-local` `26.707.30751-standalone.10`（本地候选，未发布公开 tag/Release）

## 结论

- `confirmed`：`https://ab.chatgpt.com/v1/initialize?k=client-…` 由恢复 Browser Client 中的 Statsig `initializeAsync()` 发起，不属于 Chrome Extension、Native Host、`boss_browser` RPC 或信任校验。
- `confirmed`：同一启动区块还会读取 ChatGPT identity 并初始化 Sentry；三项均已从个人运行时启动链删除。
- `confirmed`：个人插件的旧 `NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` 未修改；`~/.codex/config.toml` 修改前后 SHA-256 都是 `f42c33d384e3bcda2c00ec4221f25e904230c32923aaa8a8de7145e07a0ea3ae`。
- `confirmed`：`.10` 的隔离运行时初始化记录到的 privileged fetch 是空数组，且 `boss_browser` RPC 仍成功探测。
- `unresolved`：当前 Desktop 会话仍可能缓存 `.9` 的已加载插件代码；完整重启后的真实 Chrome 标签页读取尚未执行。
- `unresolved`：截图中的 `Illegal return statement` 没有对应提交源码，不能归因于本次远程初始化问题。

## 修改和快照

权威运行时源把遥测启动、后端标记、用户读取和事件记录四个兼容接口改为本地空实现。构建验证增加三个禁用端点扫描和初始化 fetch 陷阱；插件调试与 BOSS 技能文档不再指示用户忽略 Statsig 错误。

修改前唯一快照位于：

```text
components/codex-plugin/scripts-bak/snapshots/standalone.9-remote-chatgpt-init-prechange/
```

当前摘要：

```text
browser-client.mjs  cc0fbf13a1ab7e71d70150ea01effec7f594a28ba0426f890c2d30cfc9ce4e12
browser-service.mjs 3b270aa1dd0705d0c09c719e196a61c110e034db055e5dc4d823183a2ae68aaa
scripts-bak tree    963621722890dc140f30d6657e2a1443164f0b9900fd97d3ec68cfe4d7268fa9 (352 files)
```

## 验证结果

- Browser Client：TypeScript 类型检查通过；34 个 Bun 单元测试通过。
- Canonical build：可重复构建、基线差分、服务 RPC、策略、安装器和生成物部署检查通过。
- 初始化网络陷阱：`privilegedFetchDuringSetup=none`。
- 插件策略：16 个测试通过。
- Electron/信任生命周期：18 个测试通过；首次 reconcile 成功，第二次 `latestAction=no-op`。
- Chrome Extension：类型检查与 Vite 构建通过。
- Rust Native Host：10 个测试通过，release 构建通过；仅保留已有的未使用字段 warning。
- 三个 marketplace 档位和插件身份验证通过。
- 已安装文件不包含 `ab.chatgpt.com`、ChatGPT identity URL 或该 Sentry DSN。

归档摘要：

```text
boss-delivery-baseline.tar.gz           aec5eca2b66c986af71743aac374a858ce9ab7b6eb427f5da3efe5ef8a1564ef
boss-delivery-extension-dev.tar.gz      adeb377912188e4221b66ec6ff2ba086f1d9fb91b9d11dbc500e077302967ede
boss-delivery-full-reconstructed.tar.gz 28fa857f4c710ae64ba6963d68cca90d0725d424c8f6966aebca493d8ef2006c
```

## 本机状态

`.10` 已安装到当前用户插件 cache，`latest` 已指向 `.10`。Native Host 已在当前用户目录重新注册；preflight 返回 `ready=true`、`effectiveTrust=isolated-service-authorized`，动态探测确认 `boss_browser`、协议版本 1 和 `nativePipe=true`。本次安装备份：

```text
/Users/dmeck/.codex/backups/personal-plugin-native-host-d2cad55a-a8a2-47db-a085-6a51a6b2596e/snapshot.json
```

当前进程未被自动关闭。完整退出并重新启动 ChatGPT Desktop 后，新建任务做一次只读标签页列表，才能确认 UI 不再使用 `.9` 缓存。

## 命令

```bash
cd /Users/dmeck/project/boss-agent-work/develop
make verify

CODEX_DATA_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_CLI_BIN="$CODEX_DATA_DIR/plugins/.plugin-appserver/codex"
"$CODEX_CLI_BIN" plugin add chrome-dev@codex-chrome-automation-local --json
bun components/electron-app/bin/reconcile-native-host.mjs --dry-run --json
bun components/electron-app/bin/reconcile-native-host.mjs --json
```

如需撤销本次 Native Host 注册写入，使用首轮备份：

```bash
bun components/electron-app/bin/rollback-native-host.mjs \
  /Users/dmeck/.codex/backups/personal-plugin-native-host-d2cad55a-a8a2-47db-a085-6a51a6b2596e/snapshot.json
```

源码和生成物回滚使用本次 `.9` 唯一快照；公开 `.9` release 仍保持不变。
