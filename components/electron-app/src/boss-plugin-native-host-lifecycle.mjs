import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const bossPluginIdentity = Object.freeze({
  marketplaceName: "codex-chrome-automation-local",
  pluginName: "chrome-dev",
});

function isMissing(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}

async function readPluginManifest(versionRoot) {
  const value = JSON.parse(await fs.readFile(path.join(versionRoot, ".codex-plugin", "plugin.json"), "utf8"));
  if (value?.name !== bossPluginIdentity.pluginName || typeof value.version !== "string" || value.version.trim() === "") {
    throw new Error(`Invalid Boss投递 plugin manifest at ${versionRoot}.`);
  }
  return value;
}

export function bossPluginCacheRoot(codexHome) {
  return path.resolve(
    codexHome,
    "plugins",
    "cache",
    bossPluginIdentity.marketplaceName,
    bossPluginIdentity.pluginName,
  );
}

export async function synchronizeLatestPluginRoot(versionRoot) {
  const resolvedVersionRoot = path.resolve(versionRoot);
  await readPluginManifest(resolvedVersionRoot);
  const cacheRoot = path.dirname(resolvedVersionRoot);
  const latestRoot = path.join(cacheRoot, "latest");
  let action = "no-op";
  try {
    const information = await fs.lstat(latestRoot);
    if (information.isSymbolicLink()) {
      const target = await fs.readlink(latestRoot);
      if (path.resolve(cacheRoot, target) === resolvedVersionRoot) return { action, latestRoot };
      await fs.rm(latestRoot, { force: true });
      action = "replace-symlink";
    } else {
      const backupPath = `${latestRoot}.backup-${Date.now()}`;
      await fs.rename(latestRoot, backupPath);
      action = "backup-and-link";
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
    action = "create-link";
  }
  await fs.symlink(resolvedVersionRoot, latestRoot, process.platform === "win32" ? "junction" : "dir");
  return { action, latestRoot };
}

export async function findCurrentBossPluginVersionRoot(codexHome) {
  const cacheRoot = bossPluginCacheRoot(codexHome);
  let entries;
  try {
    entries = await fs.readdir(cacheRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const candidates = [];
  for (const entry of entries) {
    if (entry.name === "latest" || entry.name.startsWith("latest.backup-")) continue;
    const versionRoot = path.join(cacheRoot, entry.name);
    try {
      const manifest = await readPluginManifest(versionRoot);
      candidates.push({ manifest, versionRoot });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  candidates.sort((left, right) => right.manifest.version.localeCompare(left.manifest.version, undefined, { numeric: true }));
  return candidates[0]?.versionRoot ?? null;
}

export async function initializeBossPluginNativeHost({
  architecture = process.arch,
  codexHome,
  environment = process.env,
  homeDirectory,
  platform = process.platform,
  resourcesPath,
  runtimePaths,
  versionRoot,
}) {
  const expectedCacheRoot = bossPluginCacheRoot(codexHome);
  const resolvedVersionRoot = path.resolve(versionRoot);
  if (path.dirname(resolvedVersionRoot) !== expectedCacheRoot || path.basename(resolvedVersionRoot) === "latest") {
    throw new Error(`Boss投递 version root is outside its plugin cache: ${resolvedVersionRoot}`);
  }
  const manifest = await readPluginManifest(resolvedVersionRoot);
  const latest = await synchronizeLatestPluginRoot(resolvedVersionRoot);
  const installerUrl = pathToFileURL(path.join(resolvedVersionRoot, "scripts", "installManifest.mjs")).href;
  const installer = await import(`${installerUrl}?version=${encodeURIComponent(manifest.version)}`);
  if (typeof installer.install !== "function") throw new Error(`Boss投递 installer has no install() export: ${installerUrl}`);
  const result = await installer.install({
    appServerRuntimePaths: runtimePaths,
    architecture,
    codexHome,
    environment,
    ...(homeDirectory === undefined ? {} : { homeDirectory }),
    platform,
    pluginRoot: latest.latestRoot,
    pluginVersion: manifest.version,
    resourcesPath,
  });
  return { ...result, latestAction: latest.action, latestRoot: latest.latestRoot, versionRoot: resolvedVersionRoot };
}

export class BossPluginNativeHostLifecycle {
  #options;
  #queue = Promise.resolve();

  constructor(options) {
    this.#options = options;
  }

  reconcileVersionRoot(versionRoot) {
    const run = this.#queue.then(async () => await initializeBossPluginNativeHost({ ...this.#options, versionRoot }));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async reconcileCurrentInstall() {
    const versionRoot = await findCurrentBossPluginVersionRoot(this.#options.codexHome);
    return versionRoot === null ? null : await this.reconcileVersionRoot(versionRoot);
  }

  async handlePluginInstalled(event) {
    if (
      event?.marketplaceName !== bossPluginIdentity.marketplaceName ||
      event?.pluginName !== bossPluginIdentity.pluginName
    ) return null;
    return typeof event.versionRoot === "string" && event.versionRoot.trim() !== ""
      ? await this.reconcileVersionRoot(event.versionRoot)
      : await this.reconcileCurrentInstall();
  }
}

export function registerBossPluginNativeHostLifecycle({ app, pluginInstaller, onError = console.error, ...options }) {
  if (typeof app?.whenReady !== "function") throw new Error("Electron app.whenReady() is required.");
  const lifecycle = new BossPluginNativeHostLifecycle(options);
  let disposeInstallListener = null;
  const report = (error) => onError(error instanceof Error ? error : new Error(String(error)));

  if (typeof pluginInstaller?.onDidInstall === "function") {
    disposeInstallListener = pluginInstaller.onDidInstall((event) => {
      void lifecycle.handlePluginInstalled(event).catch(report);
    });
  }
  void app.whenReady().then(async () => await lifecycle.reconcileCurrentInstall()).catch(report);

  return {
    lifecycle,
    dispose() {
      if (typeof disposeInstallListener === "function") disposeInstallListener();
    },
  };
}
