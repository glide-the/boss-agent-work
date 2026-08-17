import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BossPluginNativeHostLifecycle,
  bossPluginCacheRoot,
  findCurrentBossPluginVersionRoot,
  initializeBossPluginNativeHost,
  registerBossPluginNativeHostLifecycle,
  synchronizeLatestPluginRoot,
} from "../src/boss-plugin-native-host-lifecycle.mjs";

const sourcePluginRoot = path.resolve(import.meta.dirname, "../../codex-plugin");

async function copyPluginFixture(root, version = "26.707.30751-standalone.3") {
  const codexHome = path.join(root, "codex-home");
  const versionRoot = path.join(bossPluginCacheRoot(codexHome), version);
  await fs.cp(sourcePluginRoot, versionRoot, { recursive: true });
  const manifestPath = path.join(versionRoot, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, version }, null, 2));
  const hostPath = path.join(versionRoot, "extension-host", "macos", "arm64", "extension-host");
  await fs.mkdir(path.dirname(hostPath), { recursive: true });
  await fs.writeFile(hostPath, "host");
  await fs.chmod(hostPath, 0o755);
  return { codexHome, versionRoot };
}

async function createRuntime(root) {
  const resourcesPath = path.join(root, "resources");
  const runtimePaths = {
    codexCliPath: path.join(resourcesPath, "codex"),
    nodePath: path.join(resourcesPath, "node"),
    nodeReplPath: path.join(resourcesPath, "node_repl"),
  };
  await fs.mkdir(resourcesPath, { recursive: true });
  await Promise.all(Object.values(runtimePaths).map(async (filePath) => await fs.writeFile(filePath, "runtime")));
  return { resourcesPath, runtimePaths };
}

test("startup reconciliation repairs a dangling latest link and publishes isolated Native Host files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boss-electron-lifecycle-"));
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const { codexHome, versionRoot } = await copyPluginFixture(root);
  const { resourcesPath, runtimePaths } = await createRuntime(root);
  const latestRoot = path.join(path.dirname(versionRoot), "latest");
  await fs.symlink(path.join(path.dirname(versionRoot), "missing-version"), latestRoot);

  const result = await initializeBossPluginNativeHost({
    architecture: "arm64",
    codexHome,
    homeDirectory: root,
    platform: "darwin",
    resourcesPath,
    runtimePaths,
    versionRoot,
  });
  assert.equal(result.latestAction, "replace-symlink");
  assert.equal(await fs.realpath(latestRoot), await fs.realpath(versionRoot));
  assert.equal(result.manifestPaths.length, 4);
  assert.equal(result.registryPaths.length, 2);
  const nativeManifest = JSON.parse(await fs.readFile(result.manifestPaths[0], "utf8"));
  assert.equal(nativeManifest.name, "com.openai.codexextension.dev");
  assert.deepEqual(nativeManifest.allowed_origins, ["chrome-extension://jigmpnbdhhempldjgegphdgkochgpagi/"]);
  assert.ok(nativeManifest.path.startsWith(latestRoot));
  const registry = JSON.parse(await fs.readFile(result.registryPaths[0], "utf8"));
  assert.equal(registry.entries[0].channel, "dev");
  assert.deepEqual(registry.entries[0].nativeHostNames, ["com.openai.codexextension.dev"]);
});

test("repeated reconciliation is idempotent and preserves unrelated registry entries", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boss-electron-idempotent-"));
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const { codexHome, versionRoot } = await copyPluginFixture(root);
  const { resourcesPath, runtimePaths } = await createRuntime(root);
  const sharedRegistry = path.join(root, "Library/Application Support/OpenAI/Codex/chrome-native-hosts-v2.json");
  await fs.mkdir(path.dirname(sharedRegistry), { recursive: true });
  await fs.writeFile(sharedRegistry, JSON.stringify({ schemaVersion: 2, entries: [{ entryId: "official", nativeHostNames: ["com.openai.codexextension"] }] }));
  const options = { architecture: "arm64", codexHome, homeDirectory: root, platform: "darwin", resourcesPath, runtimePaths, versionRoot };
  await initializeBossPluginNativeHost(options);
  const firstRegistryText = await fs.readFile(sharedRegistry, "utf8");
  const second = await initializeBossPluginNativeHost(options);
  assert.equal(second.latestAction, "no-op");
  const secondRegistryText = await fs.readFile(sharedRegistry, "utf8");
  assert.equal(secondRegistryText, firstRegistryText);
  const registry = JSON.parse(secondRegistryText);
  assert.equal(registry.entries.filter((entry) => entry.entryId === "official").length, 1);
  assert.equal(registry.entries.filter((entry) => entry.nativeHostNames?.includes("com.openai.codexextension.dev")).length, 1);
});

test("installer refuses to overwrite a dev manifest owned by another extension", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boss-electron-conflict-"));
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const { codexHome, versionRoot } = await copyPluginFixture(root);
  const { resourcesPath, runtimePaths } = await createRuntime(root);
  const manifestPath = path.join(
    root,
    "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.openai.codexextension.dev.json",
  );
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify({
    name: "com.openai.codexextension.dev",
    allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"],
    path: "/other/extension-host",
    type: "stdio",
  }));
  await assert.rejects(initializeBossPluginNativeHost({
    architecture: "arm64",
    codexHome,
    homeDirectory: root,
    platform: "darwin",
    resourcesPath,
    runtimePaths,
    versionRoot,
  }), /Refusing to overwrite unowned Native Messaging manifest/);
});

test("lifecycle filters unrelated install events and selects the highest installed version", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boss-electron-events-"));
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const first = await copyPluginFixture(root, "26.707.30751-standalone.1");
  const second = await copyPluginFixture(root, "26.707.30751-standalone.3");
  const runtime = await createRuntime(root);
  assert.equal(await findCurrentBossPluginVersionRoot(first.codexHome), second.versionRoot);
  const lifecycle = new BossPluginNativeHostLifecycle({
    architecture: "arm64",
    codexHome: first.codexHome,
    homeDirectory: root,
    platform: "darwin",
    ...runtime,
  });
  assert.equal(await lifecycle.handlePluginInstalled({ marketplaceName: "other", pluginName: "chrome-dev" }), null);
  const result = await lifecycle.handlePluginInstalled({
    marketplaceName: "codex-chrome-automation-local",
    pluginName: "chrome-dev",
    versionRoot: second.versionRoot,
  });
  assert.equal(result.versionRoot, second.versionRoot);
});

test("Electron registration runs on ready and subscribes to plugin installation", async () => {
  let ready;
  let listener;
  let disposed = false;
  const errors = [];
  const app = { whenReady: () => new Promise((resolve) => { ready = resolve; }) };
  const pluginInstaller = {
    onDidInstall(callback) {
      listener = callback;
      return () => { disposed = true; };
    },
  };
  const registration = registerBossPluginNativeHostLifecycle({
    app,
    pluginInstaller,
    codexHome: "/missing/codex-home",
    resourcesPath: "/missing/resources",
    runtimePaths: {},
    onError: (error) => errors.push(error),
  });
  assert.equal(typeof listener, "function");
  listener({ marketplaceName: "other", pluginName: "other" });
  ready();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, []);
  registration.dispose();
  assert.equal(disposed, true);
});

test("ordinary latest entries are backed up instead of overwritten", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boss-electron-backup-"));
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const { versionRoot } = await copyPluginFixture(root);
  const latestRoot = path.join(path.dirname(versionRoot), "latest");
  await fs.mkdir(latestRoot);
  await fs.writeFile(path.join(latestRoot, "keep.txt"), "user data");
  const result = await synchronizeLatestPluginRoot(versionRoot);
  assert.equal(result.action, "backup-and-link");
  const backups = (await fs.readdir(path.dirname(versionRoot))).filter((name) => name.startsWith("latest.backup-"));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(path.dirname(versionRoot), backups[0], "keep.txt"), "utf8"), "user data");
});
