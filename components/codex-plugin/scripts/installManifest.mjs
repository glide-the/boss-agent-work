import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const identity = Object.freeze({
  channel: "dev",
  extensionId: "jigmpnbdhhempldjgegphdgkochgpagi",
  extensionHostName: "com.openai.codexextension.dev",
});

const REGISTRY_FILENAME = "chrome-native-hosts-v2.json";
const HOST_CONFIG_FILENAME = "extension-host-config.json";
const HOST_DESCRIPTION = "Boss投递 native messaging host";

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing ${name}.`);
  return value;
}

function requirePort(value, name, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65_535) {
    throw new Error(`${name} must be a TCP port between ${allowZero ? 0 : 1} and 65535.`);
  }
  return value;
}

function isMissing(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}

async function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${crypto.randomUUID()}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, contents, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function writeIfChanged(filePath, contents) {
  try {
    if (await fs.readFile(filePath, "utf8") === contents) return false;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await atomicWrite(filePath, contents);
  return true;
}

export function resolveInstallPluginRoot(scriptDirectory = import.meta.dirname) {
  const versionRoot = path.resolve(scriptDirectory, "..");
  const segments = versionRoot.split(path.sep);
  const cacheIndex = segments.lastIndexOf("cache");
  if (cacheIndex < 1 || segments[cacheIndex - 1] !== "plugins" || segments.length <= cacheIndex + 3) {
    return versionRoot;
  }
  return path.resolve(versionRoot, "..", "latest");
}

export function extensionHostPath(pluginRoot, platform = process.platform, architecture = os.arch()) {
  const platformDirectory = { darwin: "macos", win32: "windows", linux: "linux" }[platform];
  const filename = platform === "win32" ? "extension-host.exe" : "extension-host";
  if (platformDirectory === undefined || !["arm64", "x64"].includes(architecture)) {
    throw new Error(`Invalid platform or architecture: ${platform} ${architecture}`);
  }
  return path.resolve(pluginRoot, "extension-host", platformDirectory, architecture, filename);
}

export function nativeMessagingManifestPaths({
  homeDirectory = os.homedir(),
  nativeHostName = identity.extensionHostName,
  platform = process.platform,
} = {}) {
  const filename = `${nativeHostName}.json`;
  if (platform === "darwin") {
    return [
      "Library/Application Support/Google/Chrome/NativeMessagingHosts",
      "Library/Application Support/Chromium/NativeMessagingHosts",
      "Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts",
      "Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts",
    ].map((directory) => path.resolve(homeDirectory, directory, filename));
  }
  if (platform === "linux") {
    return [path.resolve(homeDirectory, ".config/google-chrome/NativeMessagingHosts", filename)];
  }
  if (platform === "win32") {
    return [path.resolve(homeDirectory, "AppData/Local/OpenAI/extension", filename)];
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

export function nativeHostRegistryPaths({
  codexHome,
  environment = process.env,
  homeDirectory = os.homedir(),
  platform = process.platform,
}) {
  let sharedPath;
  if (platform === "darwin") {
    sharedPath = path.resolve(homeDirectory, "Library/Application Support/OpenAI/Codex", REGISTRY_FILENAME);
  } else if (platform === "linux") {
    sharedPath = path.resolve(
      environment.XDG_STATE_HOME ?? path.join(homeDirectory, ".local/state"),
      "openai-codex",
      REGISTRY_FILENAME,
    );
  } else if (platform === "win32") {
    sharedPath = path.resolve(
      environment.LOCALAPPDATA ?? path.join(homeDirectory, "AppData", "Local"),
      "OpenAI",
      "Codex",
      REGISTRY_FILENAME,
    );
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return [...new Set([sharedPath, path.resolve(codexHome, REGISTRY_FILENAME)])];
}

function hashParts(parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 32);
}

export function createRuntimeResource({
  codexHome,
  extensionHostPath: hostPath,
  pluginRoot,
  pluginVersion,
  processId = process.pid,
  resourcesPath,
  runtimePaths,
  timestamp = new Date().toISOString(),
}) {
  const paths = {
    browserClientPath: path.resolve(pluginRoot, "scripts", "browser-client.mjs"),
    codexCliPath: requireString(runtimePaths.codexCliPath, "codexCliPath"),
    codexHome: requireString(codexHome, "codexHome"),
    extensionHostPath: requireString(hostPath, "extensionHostPath"),
    nodePath: requireString(runtimePaths.nodePath, "nodePath"),
    nodeReplPath: requireString(runtimePaths.nodeReplPath, "nodeReplPath"),
    resourcesPath: requireString(resourcesPath, "resourcesPath"),
  };
  const channel = identity.channel;
  const entryId = `codex-runtime-${hashParts([
    identity.extensionHostName,
    identity.extensionId,
    channel,
    pluginVersion,
    paths.extensionHostPath,
    paths.codexCliPath,
    paths.codexHome,
    paths.resourcesPath,
  ])}`;
  const installId = `codex-install-${hashParts([
    identity.extensionHostName,
    paths.resourcesPath,
    paths.codexHome,
  ])}`;
  return {
    schemaVersion: 2,
    appServerProtocolVersion: 2,
    appVersion: pluginVersion,
    channel,
    cliVersion: pluginVersion,
    entryId,
    extensionBuildChannels: [channel],
    extensionIds: [identity.extensionId],
    installId,
    nativeHostNames: [identity.extensionHostName],
    nativeHostProtocolVersion: 2,
    nativeHostVersion: pluginVersion,
    paths,
    presence: { lastSeenAt: timestamp, pid: processId, startedAt: timestamp },
    proxyHost: "127.0.0.1",
    proxyPort: 0,
    updatedAt: timestamp,
  };
}

function overlaps(left, right) {
  return Array.isArray(left) && left.some((value) => Array.isArray(right) && right.includes(value));
}

export function upsertRuntimeRegistry(existingText, replacement) {
  let entries = [];
  try {
    const parsed = existingText == null ? null : JSON.parse(existingText);
    if (parsed?.schemaVersion === 2 && Array.isArray(parsed.entries)) entries = parsed.entries;
  } catch {
    entries = [];
  }
  const equivalent = entries.find((entry) => {
    if (entry?.entryId !== replacement.entryId) return false;
    const { presence: _leftPresence, updatedAt: _leftUpdatedAt, ...left } = entry;
    const { presence: _rightPresence, updatedAt: _rightUpdatedAt, ...right } = replacement;
    return JSON.stringify(left) === JSON.stringify(right);
  });
  entries = entries.filter((entry) => {
    if (entry?.entryId === replacement.entryId) return false;
    return !(
      entry?.installId === replacement.installId &&
      entry?.channel === replacement.channel &&
      overlaps(entry.extensionIds, replacement.extensionIds) &&
      overlaps(entry.nativeHostNames, replacement.nativeHostNames)
    );
  });
  entries.push(equivalent ?? replacement);
  entries.sort((left, right) => {
    const leftKey = `${left?.nativeHostNames?.[0] ?? ""}:${left?.channel ?? ""}:${left?.entryId ?? ""}`;
    const rightKey = `${right?.nativeHostNames?.[0] ?? ""}:${right?.channel ?? ""}:${right?.entryId ?? ""}`;
    return leftKey.localeCompare(rightKey);
  });
  return `${JSON.stringify({ schemaVersion: 2, entries }, null, 2)}\n`;
}

async function assertManifestOwnership(manifestPaths) {
  const expectedOrigin = `chrome-extension://${identity.extensionId}/`;
  for (const manifestPath of manifestPaths) {
    let current;
    try {
      current = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    } catch (error) {
      if (isMissing(error)) continue;
      throw new Error(`Cannot safely inspect existing Native Messaging manifest ${manifestPath}.`, { cause: error });
    }
    const isOwned = current?.name === identity.extensionHostName &&
      Array.isArray(current.allowed_origins) && current.allowed_origins.includes(expectedOrigin);
    if (!isOwned) {
      throw new Error(`Refusing to overwrite unowned Native Messaging manifest: ${manifestPath}`);
    }
  }
}

async function readPluginVersion(pluginRoot) {
  const manifest = JSON.parse(await fs.readFile(path.resolve(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  return requireString(manifest.version, "pluginVersion");
}

async function registerWindowsNativeHost(nativeHostName, manifestPath, platform) {
  if (platform !== "win32") return;
  await execFileAsync("reg", [
    "add",
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${nativeHostName}`,
    "/ve",
    "/t",
    "REG_SZ",
    "/d",
    manifestPath,
    "/f",
  ]);
}

export async function install({
  appServerRuntimePaths,
  architecture = os.arch(),
  codexHome = process.env.CODEX_HOME ?? path.resolve(os.homedir(), ".codex"),
  environment = process.env,
  homeDirectory = os.homedir(),
  platform = process.platform,
  pluginRoot = resolveInstallPluginRoot(),
  pluginVersion,
  processId = process.pid,
  resourcesPath = appServerRuntimePaths?.resourcesPath ?? path.dirname(appServerRuntimePaths?.nodePath ?? ""),
  timestamp = new Date().toISOString(),
} = {}) {
  const runtimePaths = appServerRuntimePaths ?? {};
  const requiredFiles = [runtimePaths.codexCliPath, runtimePaths.nodePath, runtimePaths.nodeReplPath];
  for (const candidate of requiredFiles) {
    if (typeof candidate !== "string" || !existsSync(candidate)) {
      throw new Error(`Missing bundled Electron runtime file: ${candidate ?? "undefined"}`);
    }
  }
  const hostPath = extensionHostPath(pluginRoot, platform, architecture);
  if (!existsSync(hostPath)) throw new Error(`Missing bundled Browser Use extension host binary at ${hostPath}.`);

  const resolvedVersion = pluginVersion ?? await readPluginVersion(pluginRoot);
  const manifestPaths = nativeMessagingManifestPaths({ homeDirectory, platform });
  const registryPaths = nativeHostRegistryPaths({ codexHome, environment, homeDirectory, platform });
  const manifest = `${JSON.stringify({
    allowed_origins: [`chrome-extension://${identity.extensionId}/`],
    description: HOST_DESCRIPTION,
    name: identity.extensionHostName,
    path: hostPath,
    type: "stdio",
  }, null, 2)}\n`;
  const hostConfig = `${JSON.stringify({
    schemaVersion: 1,
    channel: identity.channel,
    browserClientPath: path.resolve(pluginRoot, "scripts", "browser-client.mjs"),
    codexCliPath: runtimePaths.codexCliPath,
    extensionId: identity.extensionId,
    nodePath: runtimePaths.nodePath,
    nodeReplPath: runtimePaths.nodeReplPath,
    proxyHost: requireString(runtimePaths.proxyHost ?? "127.0.0.1", "proxyHost"),
    proxyPort: requirePort(runtimePaths.proxyPort ?? 0, "proxyPort", { allowZero: true }),
  }, null, 2)}\n`;
  const configPath = path.resolve(path.dirname(hostPath), HOST_CONFIG_FILENAME);
  const resource = createRuntimeResource({
    codexHome,
    extensionHostPath: hostPath,
    pluginRoot,
    pluginVersion: resolvedVersion,
    processId,
    resourcesPath,
    runtimePaths,
    timestamp,
  });

  // Validate every input before the first write, then publish all independent files atomically.
  await assertManifestOwnership(manifestPaths);
  await Promise.all([
    ...manifestPaths.map((manifestPath) => writeIfChanged(manifestPath, manifest)),
    writeIfChanged(configPath, hostConfig),
    ...registryPaths.map(async (registryPath) => {
      let current = null;
      try {
        current = await fs.readFile(registryPath, "utf8");
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      await writeIfChanged(registryPath, upsertRuntimeRegistry(current, resource));
    }),
  ]);
  await registerWindowsNativeHost(identity.extensionHostName, manifestPaths[0], platform);

  return { configPath, manifestPaths, registryPaths, resource };
}
