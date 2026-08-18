# 本地验证

```bash
cd /Users/dmeck/project/boss-agent-work/develop/recovery/browser-client/reconstruction
bun install --frozen-lockfile
bun run reproduce
bun run verify
```

验证器会：

1. 重新计算 `scripts-bak` 树哈希。
2. 在临时目录重跑 AST 提取。
3. 对比受管 artifacts 的字节内容。
4. 校验 semantic map 的文件、range、anchor、分类和目标路径。
5. 检查分析文档和 Mermaid 图齐全。
6. 确认恢复脚本没有修改 `src/browser-client`、`scripts` 或 `scripts-bak`。

真实 Chrome 或网站验证不属于该静态重放命令，必须另行获得授权。
