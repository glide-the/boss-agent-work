import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findCurrentBossPluginVersionRoot,
  initializeBossPluginNativeHost,
} from "./boss-plugin-native-host-lifecycle.mjs";

const valueFlags = new Map([
  ["--codex-home", "codexHome"],
  ["--version-root", "versionRoot"],
  ["--resources-path", "resourcesPath"],
  ["--codex-cli", "codexCliPath"],
  ["--node", "nodePath"],
  ["--node-repl", "nodeReplPath"],
]);

export function parseManualInstallArguments(arguments_) {
  const parsed = { dryRun: false, json: false, help: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--dry-run") parsed.dryRun = true;
    else if (argument === "--json") parsed.json = true;
    else if (argument === "--help" || argument === "-h") parsed.help = true;
    else if (valueFlags.has(argument)) {
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
      parsed[valueFlags.get(argument)] = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return parsed;
}

function firstExisting(candidates) {
  return candidates.find((candidate) => typeof candidate === "string" && existsSync(candidate)) ?? null;
}

function runtimeCandidates(resourcesPath, codexHome) {
  return {
    codexCliPath: [
      path.join(codexHome, "plugins", ".plugin-appserver", "codex"),
      path.join(resourcesPath, "codex"),
    ],
    nodePath: [
      path.join(resourcesPath, "cua_node", "bin", "node"),
      path.join(resourcesPath, "node"),
    ],
    nodeReplPath: [
      path.join(resourcesPath, "cua_node", "bin", "node_repl"),
      path.join(resourcesPath, "node_repl"),
    ],
  };
}

export async function resolveManualInstallPlan(input = {}) {
  const homeDirectory = input.homeDirectory ?? os.homedir();
  const codexHome = path.resolve(input.codexHome ?? process.env.CODEX_HOME ?? path.join(homeDirectory, ".codex"));
  const resourcesPath = path.resolve(input.resourcesPath ?? firstExisting([
    "/Applications/ChatGPT.app/Contents/Resources",
    "/Applications/Codex.app/Contents/Resources",
  ]) ?? "/Applications/Codex.app/Contents/Resources");
  const candidates = runtimeCandidates(resourcesPath, codexHome);
  const discoveredVersionRoot = input.versionRoot ?? await findCurrentBossPluginVersionRoot(codexHome);
  const versionRoot = discoveredVersionRoot == null ? null : path.resolve(discoveredVersionRoot);
  const runtimePaths = {
    codexCliPath: input.codexCliPath ?? firstExisting(candidates.codexCliPath),
    nodePath: input.nodePath ?? firstExisting(candidates.nodePath),
    nodeReplPath: input.nodeReplPath ?? firstExisting(candidates.nodeReplPath),
  };
  const required = {
    versionRoot,
    pluginManifest: versionRoot === null ? null : path.join(versionRoot, ".codex-plugin", "plugin.json"),
    installer: versionRoot === null ? null : path.join(versionRoot, "scripts", "installManifest.mjs"),
    extensionHost: versionRoot === null ? null : path.join(
      versionRoot,
      "extension-host",
      process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
      process.arch,
      process.platform === "win32" ? "extension-host.exe" : "extension-host",
    ),
    ...runtimePaths,
  };
  const missing = Object.entries(required)
    .filter(([, filePath]) => typeof filePath !== "string" || filePath === "" || !existsSync(filePath))
    .map(([name, filePath]) => ({ name, path: filePath }));
  return {
    architecture: process.arch,
    codexHome,
    homeDirectory,
    platform: process.platform,
    resourcesPath,
    runtimePaths,
    versionRoot,
    missing,
    ready: missing.length === 0,
  };
}

export async function reconcileManualInstall(plan) {
  if (!plan.ready) {
    throw new Error(`Manual Native Host reconcile is missing: ${plan.missing.map((item) => `${item.name}=${item.path ?? "undefined"}`).join(", ")}`);
  }
  return await initializeBossPluginNativeHost({
    architecture: plan.architecture,
    codexHome: plan.codexHome,
    homeDirectory: plan.homeDirectory,
    platform: plan.platform,
    resourcesPath: plan.resourcesPath,
    runtimePaths: plan.runtimePaths,
    versionRoot: plan.versionRoot,
  });
}
