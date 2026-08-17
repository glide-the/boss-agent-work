#!/usr/bin/env node

import {
  parseManualInstallArguments,
  reconcileManualInstall,
  resolveManualInstallPlan,
} from "../src/manual-install-environment.mjs";

const usage = `Boss投递 Native Host 手动 reconcile

Usage:
  node bin/reconcile-native-host.mjs [options]

Options:
  --dry-run                  只解析并检查路径，不写 manifest 或 registry
  --json                     输出 JSON
  --codex-home PATH          Codex 数据目录，默认 CODEX_HOME 或 ~/.codex
  --version-root PATH        已安装的 Boss投递版本目录
  --resources-path PATH      Electron 应用 Contents/Resources
  --codex-cli PATH           Codex CLI 可执行文件
  --node PATH                Electron 配套 Node 可执行文件
  --node-repl PATH           Electron 配套 node_repl 可执行文件
  -h, --help                 显示帮助
`;

function print(value, json) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}

try {
  const arguments_ = parseManualInstallArguments(process.argv.slice(2));
  if (arguments_.help) {
    console.log(usage);
  } else {
    const plan = await resolveManualInstallPlan(arguments_);
    if (arguments_.dryRun) {
      print(plan, arguments_.json);
      process.exitCode = plan.ready ? 0 : 1;
    } else {
      const result = await reconcileManualInstall(plan);
      print({
        correct: true,
        versionRoot: result.versionRoot,
        latestRoot: result.latestRoot,
        latestAction: result.latestAction,
        manifestPaths: result.manifestPaths,
        registryPaths: result.registryPaths,
        entryId: result.resource.entryId,
      }, arguments_.json);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
