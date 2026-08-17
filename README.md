# Boss投递开发工作区

这是 Boss投递 Chrome 自动化插件的开发工程。归档材料仍保留在上一级目录；此目录只按开发、构建和交付需要组织内容。

## 工程结构

```text
develop/
├── components/
│   ├── chrome-extension/    TypeScript + React 扩展源码
│   ├── electron-app/        Electron Main 插件安装与启动 reconcile
│   ├── native-host/         Rust Native Host 语义重建源码
│   ├── codex-plugin/        Codex 插件模板，不含编译产物
│   └── skills/              Boss 与 Chrome 调试技能源码
├── baselines/
│   ├── chrome-extension/    当前 Boss投递编译基线
│   └── native-host/         当前已签名 Native Host 基线
├── config/                  产品身份与 marketplace 配置
├── scripts/                 构建、组装、校验和打包脚本
├── dist/                    可重新生成的构建产物
├── artifacts/               可分发压缩包
└── docs/                    来源和工程边界说明
```

## 快速开始

```bash
make setup
make all
make verify
make package
```

只开发 Chrome 扩展时使用：

```bash
make extension-dev
```

只验证 Electron 应用的 Native Host 默认初始化逻辑时使用：

```bash
make electron
```

Electron Main 在 Boss投递插件安装完成后同步 `latest`、Native Messaging manifest、Host config 和 schema-v2 Runtime registry；应用启动后会再次幂等 reconcile。生产接入方式与交互时序见 [docs/native-host-install-lifecycle.md](docs/native-host-install-lifecycle.md)。

首次配置本机环境、加载 Chrome 扩展和执行 Native Host reconcile，请按 [docs/manual-install.md](docs/manual-install.md) 操作。

构建档位及风险边界见 [BUILD-MATRIX.md](BUILD-MATRIX.md)。

## 核心身份

- 产品名称：`Boss投递`
- Codex 插件：`chrome-dev`
- Chrome 扩展 ID：`jigmpnbdhhempldjgegphdgkochgpagi`
- Native Host：`com.openai.codexextension.dev`

源码来自逆向分析和语义重建，不应被描述为 OpenAI 官方源代码。当前签名 Native Host 被隔离在 `baselines/`，不会被源码构建覆盖。
