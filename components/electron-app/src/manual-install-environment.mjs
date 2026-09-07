import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { inspectPluginTrust, resolveUserCodexHome } from "./plugin-trust-preflight.mjs";
import { backupNativeHostTargets, sealNativeHostBackup } from "./native-host-backup.mjs";
import os from "node:os";
import path from "node:path";

import {
  findCurrentBossPluginVersionRoot,
  initializeBossPluginNativeHost,
} from "./boss-plugin-native-host-lifecycle.mjs";

// Keep caller environment out of serializable diagnostic output.
const planEnvironments = new WeakMap();
const planServiceProbes = new WeakMap();

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
    else if (argument === "--expected-browser-client-sha256") {
      parsed.expectedBrowserClientSha256 = arguments_[++index];
      if (!/^[a-f0-9]{64}$/i.test(parsed.expectedBrowserClientSha256 ?? "")) throw new Error("INVALID_ENVIRONMENT: --expected-browser-client-sha256 requires a SHA-256 digest.");
    } else if (valueFlags.has(argument)) {
      const value = arguments_[index + 1];
      if (value === undefined || !value.trim() || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
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
  const codexHome = resolveUserCodexHome({ ...input, homeDirectory });
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
    browserClient: versionRoot === null ? null : path.join(versionRoot, "scripts", "browser-client.mjs"),
    browserService: versionRoot === null ? null : path.join(versionRoot, "scripts", "browser-service.mjs"),
    browserServiceLauncher: versionRoot === null ? null : path.join(versionRoot, "scripts", "launch-browser-service.mjs"),
    personalMcpManifest: versionRoot === null ? null : path.join(versionRoot, ".mcp.json"),
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
  const trust = await inspectPluginTrust({ codexHome, versionRoot, runtimePaths, environment: input.environment, expectedBrowserClientSha256: input.expectedBrowserClientSha256, serviceProbe: input.serviceProbe });
  const plan = {
    architecture: process.arch,
    codexHome,
    homeDirectory,
    platform: process.platform,
    resourcesPath,
    runtimePaths,
    versionRoot,
    missing,
    trust,
    expectedBrowserClientSha256: input.expectedBrowserClientSha256,
    ready: missing.length === 0 && trust.ready,
  };
  planEnvironments.set(plan, { ...(input.environment ?? process.env) });
  if (input.serviceProbe != null) planServiceProbes.set(plan, input.serviceProbe);
  return plan;
}

export async function reconcileManualInstall(plan) {
  // Re-read config and pin the bytes inspected by dry-run before any mutation.
  const environment = planEnvironments.get(plan) ?? process.env;
  const trust = await inspectPluginTrust({ ...plan, environment, expectedBrowserClientSha256: plan.trust?.fingerprint ?? plan.expectedBrowserClientSha256, serviceProbe: planServiceProbes.get(plan) });
  if (!plan.ready || !trust.ready) {
    const issues = [...(trust.issues ?? [])];
    if (plan.missing.length) issues.push({ code: "NATIVE_HOST_REGISTRATION_ERROR", message: `Missing paths: ${plan.missing.map((item) => item.name).join(", ")}` });
    throw new Error(issues.map((item) => `${item.code}: ${item.message}`).join("\n") || "Initialization preflight did not pass.");
  }
  const installer = await import(pathToFileURL(path.join(plan.versionRoot, "scripts/installManifest.mjs")).href);
  const latestRoot = path.join(path.dirname(plan.versionRoot), "latest");
  const manifests = installer.nativeMessagingManifestPaths(plan);
  const registries = installer.nativeHostRegistryPaths({ ...plan, environment });
  // The legacy writer discards malformed/unknown registry fields. Reject them first.
  for (const filePath of registries) {
    try {
      const value = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (value?.schemaVersion !== 2 || !Array.isArray(value.entries) ||
          Object.keys(value).some((key) => !["schemaVersion", "entries"].includes(key)) ||
          value.entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
        throw new Error("Registry has an unsupported schema or fields; preserving the original file.");
      }
    } catch (error) { if (error.code !== "ENOENT") throw new Error(`CONFIG_CONFLICT: ${filePath}: ${error.message}`); }
  }
  for (const filePath of manifests) {
    try {
      const value = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (value.name !== installer.identity.extensionHostName || value.allowed_origins?.length !== 1 ||
          value.allowed_origins[0] !== `chrome-extension://${installer.identity.extensionId}/`) {
        throw new Error("Manifest is owned by another extension or has additional origins.");
      }
    } catch (error) { if (error.code !== "ENOENT") throw new Error(`CONFIG_CONFLICT: ${filePath}: ${error.message}`); }
  }
  const configPath = path.join(path.dirname(installer.extensionHostPath(plan.versionRoot, plan.platform, plan.architecture)), "extension-host-config.json");
  const backup = await backupNativeHostTargets(plan.codexHome, [...manifests, ...registries, configPath, latestRoot]);
  let result;
  let failure;
  try {
    result = await initializeBossPluginNativeHost({
      architecture: plan.architecture,
      environment,
      codexHome: plan.codexHome,
      homeDirectory: plan.homeDirectory,
      platform: plan.platform,
      resourcesPath: plan.resourcesPath,
      runtimePaths: plan.runtimePaths,
      versionRoot: plan.versionRoot,
    });
  } catch (error) { failure = error; }
  if (failure) throw new Error(`NATIVE_HOST_REGISTRATION_ERROR: ${failure.message}. Recovery snapshot: ${backup.filePath}`, { cause: failure });
  await sealNativeHostBackup(backup);
  return { ...result, backupPath: backup.filePath, connectionVerified: false, notice: "DESKTOP_RELOAD_REQUIRED: If the host has cached prior registration, reload it before read-only connection verification." };
}
