# Boss投递 Native Host 安装交互设计

## 目标与判断

Native Messaging manifest 位于用户目录，Chrome 扩展的 Service Worker 无权创建它。因此默认初始化必须属于 Electron Main 的插件安装生命周期，而不是 `chrome.runtime.onInstalled`。

本设计只增加后台生命周期，不增加安装向导或设置页。成功安装不弹窗；失败写入结构化日志，由现有插件状态和排障脚本展示原因。这样满足“安装即初始化”，同时避免为单个本地注册步骤增加过度 UI。

## 交互状态

| 状态 | 用户可见行为 | Electron Main 行为 |
| --- | --- | --- |
| 插件安装中 | 保持现有安装进度 | 等待 version root 完整落盘 |
| 初始化中 | 无额外弹窗 | 修复 `latest`，验证 Runtime，原子写 manifest/config/registry |
| 初始化成功 | 插件可以正常进入连接重试 | 记录 manifest、registry 和 Host 路径 |
| 初始化失败 | 插件显示 Disconnected | 记录缺失文件或冲突，不留下半写临时文件 |
| 应用重启 | 无操作 | ready 后再次 reconcile，自愈遗漏事件和悬空链接 |

## 业务时序

```mermaid
sequenceDiagram
    participant User as 用户
    participant Installer as Electron 插件服务
    participant Lifecycle as Boss投递 Main Lifecycle
    participant Cache as 插件 Cache/latest
    participant Files as Manifest/Config/Registry
    participant Chrome as Chrome 扩展
    participant Host as extension-host
    participant Runtime as Codex Runtime

    User->>Installer: 安装或升级 Boss投递
    Installer-->>Lifecycle: onDidInstall(marketplace, plugin, versionRoot)
    Lifecycle->>Cache: 校验身份并等待完整版本目录
    Lifecycle->>Cache: 幂等更新 latest 链接
    Lifecycle->>Lifecycle: 验证 Host、Codex CLI、Node、node_repl
    Lifecycle->>Files: 原子写入 Native Messaging manifests
    Lifecycle->>Files: 写 extension-host-config.json
    Lifecycle->>Files: upsert 两份 chrome-native-hosts-v2.json
    Chrome->>Host: connectNative(com.openai.codexextension.dev)
    Host->>Files: 读取 Boss投递 Runtime entry
    Host->>Runtime: ensureCodexAppServer / JSON-RPC
    Runtime-->>Chrome: Native Messaging Port 可用
```

## 启动自愈时序

```mermaid
sequenceDiagram
    participant App as Electron app.whenReady
    participant Lifecycle as Boss投递 Main Lifecycle
    participant Cache as chrome-dev cache
    participant Installer as installManifest.mjs

    App->>Lifecycle: reconcileCurrentInstall()
    Lifecycle->>Cache: 枚举合法版本并选择最高版本
    Lifecycle->>Cache: 检查 latest 是否悬空/过期
    alt latest 正确且配置等价
        Lifecycle->>Installer: 幂等同步
        Installer-->>Lifecycle: no content changes
    else latest 或配置过期
        Lifecycle->>Cache: 替换链接或备份普通目录
        Lifecycle->>Installer: 重新发布 Host 配置
        Installer-->>Lifecycle: 返回结构化路径
    end
```

## 安全与回滚

- 只处理 marketplace `codex-chrome-automation-local`、插件 `chrome-dev`、Host `com.openai.codexextension.dev`。
- Registry upsert 保留无关 entry；不会改写官方 Host 身份。
- `latest` 若为普通文件或目录，先改名备份，不直接删除。
- 所有文本采用同目录临时文件后 rename；失败不会留下半个 JSON。
- `Connected` 只表示 Native Port 存活；端到端仍需 `ensureCodexAppServer` 或一次真实浏览器动作验证。
