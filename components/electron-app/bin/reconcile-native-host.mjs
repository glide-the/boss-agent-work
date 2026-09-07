#!/usr/bin/env bun

import {
  parseManualInstallArguments,
  reconcileManualInstall,
  resolveManualInstallPlan,
} from "../src/manual-install-environment.mjs";

const usage = `Boss投递 Native Host 手动 reconcile

Usage:
  bun bin/reconcile-native-host.mjs [options]

Options:
  --dry-run                  检查路径、用户配置、指纹和运行时兼容性，不写入
  --json                     输出 JSON
  --codex-home PATH          Codex 数据目录，默认 CODEX_HOME 或 ~/.codex
  --version-root PATH        已安装的 Boss投递版本目录
  --resources-path PATH      Electron 应用 Contents/Resources
  --codex-cli PATH           Codex CLI 可执行文件
  --node PATH                Electron 配套 Node 可执行文件
  --node-repl PATH           Electron 配套 node_repl 可执行文件
  --expected-browser-client-sha256 HEX  比较受审查产物的 SHA-256，不授予信任
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
        nativeHostRegistered: true,
        connectionVerified: result.connectionVerified,
        backupPath: result.backupPath,
        notice: result.notice,
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
