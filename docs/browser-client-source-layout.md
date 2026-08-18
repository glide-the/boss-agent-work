# Browser Client 源码、构建与产物目录规范

## 1. 决策

`components/codex-plugin/src/browser-client` 是 Browser Client 及其辅助脚本的唯一可维护源码根目录，也是唯一生产构建入口。

以下目录职责固定，不能混用：

| 路径 | 职责 | 是否参与生产构建 |
|---|---|---|
| `components/codex-plugin/src/browser-client/` | TypeScript 源码、Bun 构建器、测试和锁文件 | 是，唯一入口 |
| `components/codex-plugin/scripts/` | Codex 插件运行时加载的生成物 | 否，只能由构建器写入 |
| `components/codex-plugin/scripts-bak/` | 修改前完整基线和回滚证据 | 否，禁止覆盖、禁止嵌入生成物 |
| `recovery/browser-client/` | AST 报告、哈希、差分 fixture 和审计报告 | 否，只保存证据 |
| `tools/browser-client-recovery/` | 旧的混合目录 | 已删除；任何重新出现均视为布局回归 |

过去的 `tools/browser-client-recovery` 同时包含 AST 分析、TypeScript 构建、部署和回滚，容易让人误以为真正源码在 `tools`，也使 `src/browser-client` 不是自包含构建单元。该布局被废止。

在迁移生产构建前，必须先按 `docs/browser-client-reconstruction-resources.md` 建立 `recovery/browser-client/reconstruction` 可复跑工程。该工程可以读取基线生成证据，但不能承担生产构建，也不保存第二份生产源码。

## 2. 目标目录

```text
components/codex-plugin/src/browser-client/
├── package.json
├── bun.lock
├── tsconfig.json
├── index.ts
├── browser-runtime.generated.js
├── browser-runtime.generated.d.ts
├── build/
│   ├── build.ts
│   ├── deploy.ts
│   ├── inventory.ts
│   └── verify.ts
├── config/
│   ├── extension-id.json
│   └── standalone-identity.json
├── contracts/
├── runtime/
│   ├── node-repl-display.ts
│   ├── process-shim.ts
│   └── tabs.ts
├── security/
│   ├── browser-security.ts
│   └── site-status-policy.ts
├── scripts/
│   ├── check-extension-installed.ts
│   ├── check-native-host-manifest.ts
│   ├── chrome-is-running.ts
│   ├── installed-browsers.ts
│   ├── install-manifest.ts
│   ├── open-chrome-window.ts
│   ├── patch-browser-client-site-status.ts
│   └── verify-standalone.ts
├── vendor/
│   ├── classic-level-adapter.ts
│   └── prebuilds/classic-level/...
└── test/
```

生产命令统一从该目录执行：

```bash
cd /Users/dmeck/project/boss-agent-work/develop/components/codex-plugin/src/browser-client
bun install --frozen-lockfile
bun run build
bun run verify
bun run deploy
```

仓库根目录的 `make browser-client` 只允许转发到上述命令，不能再进入 `tools/browser-client-recovery`。

## 3. 逐文件来源要求

`scripts` 顶层 12 个第一方文件必须全部由唯一源码根生成：

| 运行时产物 | 唯一来源 |
|---|---|
| `browser-client.mjs` | `src/browser-client/index.ts` 及其模块依赖 |
| `check-extension-installed.js` | `src/browser-client/scripts/check-extension-installed.ts` |
| `check-native-host-manifest.js` | `src/browser-client/scripts/check-native-host-manifest.ts` |
| `chrome-is-running.js` | `src/browser-client/scripts/chrome-is-running.ts` |
| `installed-browsers.js` | `src/browser-client/scripts/installed-browsers.ts` |
| `installManifest.mjs` | `src/browser-client/scripts/install-manifest.ts` |
| `open-chrome-window.js` | `src/browser-client/scripts/open-chrome-window.ts` |
| `patch-browser-client-site-status.mjs` | `src/browser-client/scripts/patch-browser-client-site-status.ts` |
| `site-status-policy.mjs` | `src/browser-client/security/site-status-policy.ts` |
| `verify-standalone.mjs` | `src/browser-client/scripts/verify-standalone.ts` |
| `extension-id.json` | `src/browser-client/config/extension-id.json` |
| `standalone-identity.json` | `src/browser-client/config/standalone-identity.json` |

`scripts/node_modules` 是第三方运行时依赖树，不伪装为项目 TypeScript。其版本、完整性和许可证必须由 `src/browser-client/bun.lock` 与构建清单管理；`classic-level.mjs` 是受审计的 ESM adapter。生产构建不能从 `scripts-bak/node_modules` 复制第三方依赖。

## 4. Browser Client 主体门槛

`index.ts` 只允许引用 `src/browser-client` 内的模块和锁定的第三方包。以下任一情况都判定为未完成：

- 引用 `#browser-client-baseline`；
- import、读取或嵌入 `scripts-bak/browser-client.mjs`；
- 从 `scripts/browser-client.mjs` 反向加载自身；
- 仅用 TypeScript 包装旧 bundle；
- 将压缩 bundle 改扩展名为 `.ts` 后宣称模块化恢复完成；
- 缺少 Browser Security、Runtime Bridge、Browser/Tab API、transport/CDP/Playwright 的源码或明确第三方边界。

允许用基线 bundle 做 AST 分析和差分测试，但它只能作为测试输入，不能进入生产依赖图。

## 5. 构建和部署门禁

构建必须按顺序执行：

1. 校验 `scripts-bak` 哈希未变化。
2. strict TypeScript typecheck。
3. Bun 构建全部 10 个 JS/MJS 入口并复制 2 个受校验 JSON。
4. 生成逐文件 manifest，包含源码、产物、模式、SHA-256 和来源分类。
5. 检查生产依赖图不含 `scripts-bak`、`tools/browser-client-recovery` 或当前 `scripts`。
6. 对第一方 12 个文件执行基线/候选差分或结构化行为测试。
7. 校验第三方依赖版本和树摘要。
8. 全部通过后才原子部署到 `scripts`。

`scripts` 中出现未被 manifest 管理的第一方顶层文件时，构建失败；缺少任一映射时也失败。

## 6. 当前状态

截至 2026-08-18，旧实现的问题已经修正：12 个第一方顶层文件全部进入 canonical manifest，10 个 JS/MJS 入口由 Bun 从唯一源码根生成，2 个 JSON 从 `config` 复制并校验；生产依赖图不含基线、当前 `scripts` 或旧工具目录。`scripts` 已通过原子部署替换，部署树 SHA-256 为 `82dcd6409b504ae31ded5caca5400b9712cae040011dae4d0e6ffb51fbd9b4dd`；`scripts-bak` 仍为 344 个文件，树 SHA-256 保持 `85d1bc4f7d456ef75eceab7df6159ebfdfce23de0af51175ec9ba2dc9e579964`。

Browser Client 主体采用“已提取严格 TypeScript 模块 + 格式化兼容内核”的分阶段结构。Process Shim、Tab API、Browser Security、node_repl display bridge 和本地 `site_status` 已提取为实际参与 bundle 的模块；其余无法可靠恢复原始模块名/类型的内联运行时和第三方代码保留在 `browser-runtime.generated.js`。它是可审计、可重复物化的语义等价 JavaScript，不是作者原始源码，也不应被误述为完整上游 TypeScript 恢复。

## 7. 实施顺序

1. 完成目录与职责文档。— PASS
2. 建立并复跑 `recovery/browser-client/reconstruction` 五类工程资源。— PASS
3. 人工审查 artifacts、semantic maps、置信度和限制。— PASS
4. 将生产 Bun 构建迁入 `src/browser-client`。— PASS
5. 补齐顶层第一方入口并移除基线生产依赖。— PASS
6. 差分通过后原子部署到 `scripts`。— PASS
7. 后续上游漂移时，先更新恢复证据，再逐步缩小兼容内核；不得凭猜测改写行为。
