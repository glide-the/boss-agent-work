# 构建矩阵

| 档位 | Chrome 扩展 | Native Host | 主要用途 | 输出目录 |
| --- | --- | --- | --- | --- |
| `baseline` | 当前 Boss投递 `1.1.5.2` 编译产物 | OpenAI Developer ID 签名的 arm64 二进制 | 复现当前交付、回归比较 | `dist/baseline/marketplace/` |
| `extension-dev` | TypeScript/React 语义重建源码构建 | 当前签名 arm64 二进制 | 扩展 UI、消息桥和 BOSS 业务开发 | `dist/extension-dev/marketplace/` |
| `full-reconstructed` | TypeScript/React 语义重建源码构建 | Rust 语义重建源码构建 | Native Messaging 协议和 Host 逻辑研究 | `dist/full-reconstructed/marketplace/` |

## 产物边界

- `components/`：可编辑源码、插件模板和技能源码。
- `baselines/`：不可从当前源码等价重建的已签名/已编译基线，仅用于比较和组装。
- `dist/`：构建及组装结果，可随时清理并重新生成。
- `artifacts/`：可分发压缩包及 SHA-256 文件。

`full-reconstructed` 中的 Native Host 不是 OpenAI 官方源码产物，也不带 OpenAI Developer ID 签名，不应用于生产部署。
