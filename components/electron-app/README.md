# Boss投递 Electron Main 集成

这个组件负责 Electron 应用侧的插件安装生命周期。它不包含 Renderer，也不自行安装 Chrome 扩展。

生产入口调用 `registerBossPluginNativeHostLifecycle()`：

```js
import { registerBossPluginNativeHostLifecycle } from "./src/boss-plugin-native-host-lifecycle.mjs";

const lifecycle = registerBossPluginNativeHostLifecycle({
  app,
  pluginInstaller,
  codexHome,
  resourcesPath: process.resourcesPath,
  runtimePaths: {
    codexCliPath: path.join(process.resourcesPath, "codex"),
    nodePath: path.join(process.resourcesPath, "node"),
    nodeReplPath: path.join(process.resourcesPath, "node_repl"),
  },
  onError: (error) => logger.error("Boss投递 Native Host 初始化失败", error),
});
```

`pluginInstaller` 只需要实现 `onDidInstall(listener)`；安装事件应提供 `marketplaceName`、`pluginName`，最好同时提供 `versionRoot`。Electron `ready` 后组件也会扫描当前安装并 reconcile，因此旧版本升级或遗漏事件可以自愈。
