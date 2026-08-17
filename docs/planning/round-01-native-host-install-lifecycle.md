# Round 01：Boss投递 Native Host 安装生命周期

## 固定 Prompt Architect 模板

```text
You are an Expert Prompt Architect.

Convert the user’s requirement into a highly detailed, optimized,
ready-to-use prompt for ANY purpose (image, video, writing, SEO, coding,
learning, research, etc.).

Instructions

Identify what the user is trying to achieve.
Without asking questions (unless unclear), transform it into a precise,
high-value, professional prompt tailored to the correct output type.
Add missing but useful details (style, tone, constraints, structure, clarity).
Ensure the prompt is copy-paste ready for the intended AI tool.

Deliver:
Optimized Prompt - the final refined prompt
Optional Enhancers - optional add-ons that the user can include

OUTPUT FORMAT
Optimized Prompt:
[Expert-level prompt based on the requirement]

USER REQUIREMENT: {{task}}
```

## Optimized Prompt

在 `/Users/dmeck/project/boss-agent-work/develop` 中补齐 Boss投递的 Electron Main 插件安装生命周期，使 Native Host 在 `chrome-dev` 插件安装或升级完成后默认初始化，并在 Electron 应用启动时执行幂等 reconcile。以 `Codex-Original-Functionality-Round52-Delivery` 的 Native Messaging 文档、Round 82 源码和测试为参考，正确维护 `latest` 插件链接、Chrome Native Messaging manifest、`extension-host-config.json` 与 `chrome-native-hosts-v2.json` Runtime registry。所有写入必须限定为 Boss投递的扩展 ID `jigmpnbdhhempldjgegphdgkochgpagi`、Host `com.openai.codexextension.dev` 和 marketplace `codex-chrome-automation-local`，不得覆盖官方 `com.openai.codexextension` 注册。

Electron Main 必须拥有文件系统写入和插件安装事件接入责任；Chrome 扩展只在启动后调用 `connectNative`，不能伪装成可写系统 manifest 的安装器。实现需兼容重复安装、应用重启和旧 `latest` 悬空链接，采用原子写入，保留无关 registry 条目，并返回可诊断的结构化结果。交付应包含最小生产接入 API、隔离 HOME/CODEX_HOME 测试、构建产物、交互设计稿、业务时序图、回滚边界和 live 验证；不得仅凭静态文件存在或 Popup 文案宣称端到端连接成功。

## Optional Enhancers

- 已采用：为安装、启动 reconcile、Chrome 连接生成协议时序图。
- 已采用：记录关键输入文件修改前 SHA-256。
- 已采用：隔离 HOME/CODEX_HOME 验证 manifest、registry 与 `latest` 链接。
- 已采用：live 验证分层为 `manifest-valid`、`runtime-published`、`port-connected`。
- 暂不采用：新增 Electron Renderer 设置页；本轮无须为一次默认初始化增加 UI。

## 本轮输入与 checkpoint

- settled：Chrome 扩展和 Native Host 已有三个构建档位，插件身份已经隔离。
- in-progress：补齐 Electron 应用的插件安装/启动生命周期。
- 参考文档：`/Users/dmeck/project/Codex-Original-Functionality-Round52-Delivery/docs/Codex-Chrome-Native-Messaging-and-Round-Planning-Workflow.md`。
- 参考源码：Round 82 的 `chrome-plugin-marketplace-lifecycle.ts`、`chrome-plugin-native-host-lifecycle.ts`、`chrome-native-host-runtime-synchronizer.ts` 和 `chrome-native-host-protocol.ts`。
- 当前观测：Boss投递 dev manifest 缺失；`chrome-dev/latest` 指向不存在的 `26.601.21317`；两个 Runtime registry 都没有 Boss投递扩展/Host 条目。
- 当前代码：`installManifest.mjs` 仅写一个 Chrome manifest 和 Host config，不写 schema-v2 registry。

## 范围与非目标

### 范围

1. 新增 Electron Main 集成组件和插件安装事件入口。
2. 安装后及应用启动时幂等同步 `latest`、manifest、Host config 和 v2 registry。
3. 将 Electron 集成作为独立构建物，不与 Chrome 扩展或 Rust Host 源码混合。
4. 更新验证、构建矩阵、交互说明和时序文档。
5. 在隔离目录验证后修复本机当前 Boss投递安装。

### 非目标

- 不新增 Renderer 设置页面或安装向导。
- 不改写官方 `com.openai.codexextension` manifest/registry 身份。
- 不声称重建 Rust Native Host 等价于官方源码。
- 不在测试中启动或轰炸 BOSS 页面。

## 证据与技术分析方法

原始参考模块属于 Electron Main / Native Host SCC；本轮仅恢复其插件安装纵切面，不扩展到 Renderer、Preload、Worker 或完整 Computer Use 设置页。调用链为：Electron 插件安装完成事件 → cache/version root → `latest` reconcile → 安装器 → manifest/config/registry 原子写入 → Chrome `connectNative` → Host 选择 Runtime。

修改前 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `components/codex-plugin/scripts/installManifest.mjs` | `99d72df8990472991386d3113a2419d746fc7952f1d09b548211c92e090a7dce` |
| `components/codex-plugin/scripts/verify-standalone.mjs` | `40f43b6c57b5c5412d4eeb845c08194c3c449a8c654fef8ed924b3fac1136bf6` |
| `scripts/assemble-marketplace.sh` | `8d9d1fc9c0614fe49b49d2d26fcd40e1622ed8f32cc5a378c7da24043ec6889c` |
| `scripts/verify.sh` | `098df301c6dc9669aefef49642c6a4e8b55d3149bdbc35d775562e2268380eec` |

## 实现与生产接入计划

1. 将插件安装器改为可读、可测试的 ESM，并补齐四类 macOS Chrome manifest 与两个 Runtime registry。
2. 新增 Electron Main lifecycle：严格过滤 marketplace/plugin 身份，修复 `latest`，在安装事件后同步；应用 ready 时自动 reconcile 当前版本。
3. 通过依赖注入对接 Electron `app.whenReady()` 和插件服务 `onDidInstall()`，避免编造特定 Electron 框架 API。
4. Electron 构建物只包含 Main 集成代码与接入说明；marketplace 构建仍包含扩展、Host、插件脚本和技能。

## 测试、构建和运行时验证

- Node 定向测试：悬空链接修复、普通目录备份、安装事件身份过滤、幂等 registry upsert、无关 entry 保留。
- 插件校验：扩展 ID、Host 名称、安装器导出和打包后文件存在。
- `make all && make verify`：验证三档 marketplace 与 Electron 集成构建物。
- 隔离 live：临时 HOME/CODEX_HOME 写 manifest 和 registry，不接触真实用户目录。
- 真实 live：仅在目标文件缺失或属于 Boss投递时写入；验证 manifest/registry/path；Chrome 扩展 reload 后再验证 Native Port。

## 完成条件与质量门禁

- 插件安装事件和 Electron ready 均能触发同一幂等初始化。
- `latest` 指向刚安装版本；manifest 的 path 指向 `latest` 内 Host；allowed origin 仅包含 Boss投递扩展。
- v2 registry 同时发布 shared 与 CODEX_HOME 路径，保留官方条目。
- 自有代码检查、定向测试和全部构建验证通过。
- `port-connected` 只有在 Chrome reload 后实际连接成功才可报告；否则保持 residual。

## Residual、Blocked 与回滚策略

- 若缺少 Codex CLI、Node 或 node_repl，则返回明确错误，不写半套注册。
- 若已有同名 manifest 指向非 Boss投递 cache，live 部署停止并报告冲突。
- 回滚只删除/恢复 Boss投递 dev manifest、registry 中匹配扩展 ID + Host 的 entry，以及本轮创建的 `latest` 链接；不处理官方 Host。
- Chrome 已加载旧 Service Worker 时，需要用户在 `chrome://extensions` reload；这是 `port-connected` 验收前置条件。

## 计划与证据路径

- 本计划：`docs/planning/round-01-native-host-install-lifecycle.md`
- 交互与时序设计：`docs/native-host-install-lifecycle.md`
- Electron Main 代码：`components/electron-app/`
- 隔离测试：`components/electron-app/test/`
- 构建输出：`dist/electron-app/`

## 执行结果（2026-08-17）

- settled：Electron Main 的安装事件与 app ready reconcile 已实现，插件版本提升为 `26.707.30751-standalone.3`。
- settled：隔离测试 6/6 通过，覆盖悬空链接、幂等、registry 保留、manifest 冲突、事件过滤和普通目录备份。
- settled：`make all`、`make verify`、`make package` 通过；三档产物均包含独立 `marketplace/` 与 `electron-app/`。
- settled：本机 marketplace 已切换到 `develop/dist/baseline/marketplace`，`chrome-dev` 已升级到 `standalone.3`。
- settled：真实 Google Chrome manifest 校验 `correct: true`；CODEX_HOME registry 包含 `codex-runtime-e64d7e3ba4705379f155ffd39e239713`。
- settled：Chrome 已以 `chrome-extension://jigmpnbdhhempldjgegphdgkochgpagi/` 参数实际启动 Boss投递 `extension-host`，可作为 `port-connected` 证据。
- residual：本轮未通过浏览器客户端执行 BOSS 页面动作，因此不把 Native Port 存活夸大为具体业务自动化动作已验收。
