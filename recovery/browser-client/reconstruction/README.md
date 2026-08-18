# Browser Client 可复现恢复工程

本目录把发布态 `components/codex-plugin/scripts-bak` 作为不可变输入，重放 Browser Client 的文件清单、Source Map 检查、AST 索引、协议/安全调用图、第三方边界和语义映射验证。

它不是第二份生产源码，也不负责生成插件运行时文件。唯一可维护源码和生产构建入口是：

```text
components/codex-plugin/src/browser-client
```

## 重放

```bash
cd /Users/dmeck/project/boss-agent-work/develop/recovery/browser-client/reconstruction
bun install --frozen-lockfile
bun run reproduce
bun run verify
```

## 便携验证包

```bash
bun run package --output /tmp/browser-client-reconstruction-check --include-input
cd /tmp/browser-client-reconstruction-check/reconstruction
bun install --frozen-lockfile
bun run reproduce
bun run verify
```

便携包同时包含 canonical source、当前 `scripts` 候选和可选的 `scripts-bak` 输入，使验证器可以确认恢复重放没有修改三棵受保护树。

没有 Source Map 或原始仓库证据，不能称为作者字节级源码恢复。这里输出的是可审计的语义恢复证据。

## 显式物化第一方 CLI

标准 `reproduce` 不修改源码。人工审查 `maps/utility-scripts.semantic-map.json` 后，可显式执行一次：

```bash
bun run materialize-utilities
```

该命令只把 map 中五个可读第一方 CLI 写到 canonical `.ts` 目标；目标已存在时拒绝覆盖。它不会添加 `@ts-nocheck`，物化后必须完成 strict 类型恢复。

## 显式物化兼容内核与签名依赖

以下命令只用于基于固定哈希重建/核对 canonical 证据，标准 `reproduce` 不会调用它们：

```bash
bun run materialize-runtime
bun run materialize-third-party
```

`materialize-runtime` 校验发布基线哈希、格式化 JavaScript，并按 `maps/materialized-runtime-map.json` 抽取已评审 TypeScript 模块的 import 边界。`materialize-third-party` 固定 OpenAI Developer ID 签名的 `classic-level.node` 资产及其 SHA-256。二者都不能证明作者原始源码或构建环境已找回。
