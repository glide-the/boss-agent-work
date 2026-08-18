# Browser Client 恢复任务规划

## 输入

`components/codex-plugin/scripts-bak`，预期 344 个文件，树 SHA-256：

```text
85d1bc4f7d456ef75eceab7df6159ebfdfce23de0af51175ec9ba2dc9e579964
```

## 输出

- `analysis/`：阶段结论和证据边界。
- `artifacts/`：脚本生成的 CSV/JSON 静态索引。
- `maps/`：AST range 到语义名、模块和置信度的映射。
- `diagrams/`：恢复流水线、运行时协议和模块依赖图。
- `scripts/`：Bun 可复跑工具。

## 顺序

1. 锁定输入树和顶层文件哈希。
2. 检查 Source Map、`sourcesContent` 和原始路径。
3. 使用 TypeScript Compiler API 解析全部第一方 JS/MJS。
4. 生成 import/export、声明、函数、class、字符串和调用图。
5. 标注第三方边界和业务模块候选。
6. 审核 semantic maps。
7. 将获批模块重建到唯一源码根。
8. 对源码候选与基线做差分验证。

## 完成边界

恢复工程可复跑不等于生产源码已完成。只有 `src/browser-client` 脱离基线生产依赖并通过全部差分后，才能切换 `scripts`。
