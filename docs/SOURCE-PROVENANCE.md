# 源码与构建物来源

| 开发目录 | 来源 | 性质 |
| --- | --- | --- |
| `components/chrome-extension/` | `codex-1.1.5_0/codex-extension-source-recovery-ts-react-full-verification/reconstruction/reconstructed/` | TypeScript/React 语义重建源码，已应用 Boss投递名称、扩展身份和 `.dev` Host |
| `components/native-host/` | `codex-native-host-analysis-asm-rust-full-verification/.../reconstructed/native-host-rust/` | 根据二进制符号和协议证据重建的 Rust 源码 |
| `components/codex-plugin/` | `codex-chrome-automation-marketplace/plugins/chrome-dev/` | Codex 插件模板；编译扩展和 Host 已剥离 |
| `components/skills/` | 上级工作区 `skills/` | Boss 业务与 Chrome 调试技能源码 |
| `baselines/chrome-extension/` | 当前 Boss投递插件 `chrome-extension/` | 版本 `1.1.5.2` 的已编译基线 |
| `baselines/native-host/` | 当前 Boss投递插件 `extension-host/macos/arm64/extension-host` | OpenAI Developer ID 签名的 arm64 Mach-O 基线 |

`components/skills/` 是项目个人技能的权威源码。`make setup` 或 `make install-skills` 会把六个 BOSS/Chrome 维护技能软连接到 `$AGENTS_HOME/skills/`（默认 `~/.agents/skills/`），并把 `boss-send-resume-button` 和 `chrome-file-upload-patterns` 软连接到 `$CODEX_HOME/skills/`（默认 `~/.codex/skills/`）。初始化不再复制技能文件；用户入口与项目源码始终指向同一目录。marketplace 内的 `boss-delivery` 继续由 `components/codex-plugin/skills/` 提供，避免重复发现。

## 不能混淆的边界

1. Rust 语义重建 Host 不能替代或冒充 OpenAI 签名 Host。
2. TypeScript/React 工程是可构建的语义重建源码，不保证与原压缩 JavaScript 字节一致。
3. `dist/` 中的构建结果不属于源码；`make clean` 后应能重新生成。
4. `baseline` 档位是基线重组，不是源码重建。
