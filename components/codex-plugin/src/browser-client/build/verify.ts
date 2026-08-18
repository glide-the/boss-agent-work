#!/usr/bin/env bun

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expectedFirstPartyOutputs } from "./inventory.ts";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface BrowserRuntimeModule {
  setupBrowserRuntime: (options: unknown) => Promise<void>;
}

interface SiteStatusPolicyInstance {
  throwIfBlocksUrl(
    url: string,
    backend: string,
    options?: Record<string, unknown>,
  ): Promise<void>;
}

interface SiteStatusPolicyModule extends Record<string, unknown> {
  SiteStatusPolicy: new (options: Record<string, unknown>) => SiteStatusPolicyInstance;
  resolveSiteStatusConfiguration(environment: Record<string, unknown>): unknown;
}

interface InstallManifestModule extends Record<string, unknown> {
  identity: unknown;
  createRuntimeResource(options: Record<string, unknown>): unknown;
  extensionHostPath(root: string, platform: string, architecture: string): string;
  nativeMessagingManifestPaths(options: Record<string, unknown>): string[];
  nativeHostRegistryPaths(options: Record<string, unknown>): string[];
  resolveInstallPluginRoot(directory: string): string;
  upsertRuntimeRegistry(source: string, resource: unknown): unknown;
}

interface PatchModule extends Record<string, unknown> {
  patchBrowserClientSource(source: string): { changed: boolean; source: string };
  verifyPatchedBrowserClientSource(source: string): string[];
}

const sourceRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(sourceRoot, "../../../..");
const candidateRoot = path.join(workspaceRoot, "recovery/browser-client/dist");
const baselineRoot = path.join(
  workspaceRoot,
  "components/codex-plugin/scripts-bak",
);
const backupManifestPath = path.join(
  workspaceRoot,
  "recovery/browser-client/fixtures/scripts-backup-manifest.json",
);
const setupSnapshotPath = path.join(
  sourceRoot,
  "test/runtime-setup-snapshot.ts",
);

function sha256(contents: Uint8Array | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function objectRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

async function regularFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await regularFiles(root, filePath)));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

async function treeDigest(root: string): Promise<{ fileCount: number; sha256: string }> {
  const files = (await regularFiles(root)).sort((left, right) =>
    left.localeCompare(right),
  );
  const hash = createHash("sha256");
  for (const fileName of files) {
    hash.update(path.relative(root, fileName));
    hash.update("\0");
    hash.update(await readFile(fileName));
    hash.update("\0");
  }
  return { fileCount: files.length, sha256: hash.digest("hex") };
}

async function run(
  command: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  const child = Bun.spawn(command, {
    cwd: options.cwd ?? workspaceRoot,
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function importFresh<T>(filePath: string): Promise<T> {
  const url = pathToFileURL(filePath);
  url.searchParams.set("canonicalVerification", crypto.randomUUID());
  return (await import(url.href)) as T;
}

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json(): Promise<unknown> {
      return payload;
    },
  };
}

async function policySnapshot(policyModule: SiteStatusPolicyModule): Promise<unknown> {
  let disabledCalls = 0;
  const disabled = new policyModule.SiteStatusPolicy({
    getEnvironment: () => ({}),
    getFetch: () => async () => {
      disabledCalls += 1;
    },
    logger: () => {},
  });
  await disabled.throwIfBlocksUrl("https://example.com/private", "chrome");

  const requestUrls: string[] = [];
  const enabled = new policyModule.SiteStatusPolicy({
    getEnvironment: () => ({
      BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true",
      BROWSER_USE_SITE_STATUS_BASE_URL: "http://127.0.0.1:8787",
    }),
    getFetch: () => async (url: string) => {
      requestUrls.push(url);
      return response({ feature_status: { agent: true } });
    },
    getTurnMetadata: () => ({ session_id: "session", turn_id: "turn" }),
    logger: () => {},
  });
  await enabled.throwIfBlocksUrl(
    "https://www.example.com/one?secret=1#fragment",
    "chrome",
  );
  await enabled.throwIfBlocksUrl("https://example.com/two", "chrome");

  const logs: unknown[] = [];
  const failOpen = new policyModule.SiteStatusPolicy({
    getEnvironment: () => ({ BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true" }),
    getFetch: () => async () => {
      throw new Error("private transport detail");
    },
    logger: (event: unknown) => logs.push(event),
  });
  await failOpen.throwIfBlocksUrl("https://example.org/path?secret=1", "iab");

  const blocked = new policyModule.SiteStatusPolicy({
    getEnvironment: () => ({ BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true" }),
    getFetch: () => async () => response({ feature_status: { agent: false } }),
    logger: () => {},
  });
  let blockedSnapshot: unknown = null;
  try {
    await blocked.throwIfBlocksUrl("https://blocked.example/path", "chrome", {
      createBlockedError: (reason: string) => new TypeError(`blocked:${reason}`),
      displayName: "Chrome",
    });
  } catch (error) {
    blockedSnapshot = {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    disabled: {
      calls: disabledCalls,
      configuration: policyModule.resolveSiteStatusConfiguration({}),
    },
    allowedAndCached: { calls: requestUrls.length, requestUrl: requestUrls[0] },
    failOpen: logs,
    blocked: blockedSnapshot,
  };
}

function installSnapshot(module: InstallManifestModule): unknown {
  const runtimePaths = {
    codexCliPath: "/fixture/bin/codex",
    nodePath: "/fixture/bin/node",
    nodeReplPath: "/fixture/node_repl.mjs",
  };
  const resource = module.createRuntimeResource({
    codexHome: "/fixture/codex-home",
    extensionHostPath: "/fixture/plugin/extension-host/macos/arm64/extension-host",
    pluginRoot: "/fixture/plugin",
    pluginVersion: "fixture-version",
    processId: 4242,
    resourcesPath: "/fixture/resources",
    runtimePaths,
    timestamp: "2026-08-18T00:00:00.000Z",
  });
  return {
    exports: Object.keys(module).sort(),
    identity: module.identity,
    extensionHost: module.extensionHostPath("/fixture/plugin", "darwin", "arm64"),
    manifests: ["darwin", "linux", "win32"].map((platform) =>
      module.nativeMessagingManifestPaths({
        homeDirectory: "/fixture/home",
        platform,
      }),
    ),
    registries: ["darwin", "linux", "win32"].map((platform) =>
      module.nativeHostRegistryPaths({
        codexHome: "/fixture/codex-home",
        environment: {},
        homeDirectory: "/fixture/home",
        platform,
      }),
    ),
    resource,
    invalidRegistry: module.upsertRuntimeRegistry("not-json", resource),
    idempotentRegistry: module.upsertRuntimeRegistry(
      JSON.stringify({ schemaVersion: 2, entries: [resource] }),
      resource,
    ),
    roots: [
      module.resolveInstallPluginRoot("/fixture/plugin/scripts"),
      module.resolveInstallPluginRoot(
        "/fixture/plugins/cache/market/plugin/version/scripts",
      ),
    ],
  };
}

function patchSnapshot(module: PatchModule, source: string): unknown {
  const idempotent = module.patchBrowserClientSource(source);
  let partialError: string | null = null;
  try {
    module.patchBrowserClientSource("const __BossSiteStatusPolicy = true;");
  } catch (error) {
    partialError = error instanceof Error ? error.message : String(error);
  }
  return {
    exports: Object.keys(module).sort(),
    idempotent: {
      changed: idempotent.changed,
      sourceUnchanged: idempotent.source === source,
    },
    verification: module.verifyPatchedBrowserClientSource(source),
    partialError,
  };
}

async function runtimeSetupSnapshot(
  runtimeRoot: string,
  sourceName: "baseline" | "candidate",
): Promise<unknown> {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), `browser-runtime-${sourceName}-`),
  );
  try {
    const pluginRoot = path.join(temporaryRoot, "plugin");
    const scriptsRoot = path.join(pluginRoot, "scripts");
    await mkdir(scriptsRoot, { recursive: true });
    await symlink(
      path.join(workspaceRoot, "components/codex-plugin/docs"),
      path.join(pluginRoot, "docs"),
      "dir",
    );
    for (const name of ["browser-client.mjs", "site-status-policy.mjs"]) {
      await copyFile(path.join(runtimeRoot, name), path.join(scriptsRoot, name));
    }
    await symlink(
      path.join(runtimeRoot, "node_modules"),
      path.join(scriptsRoot, "node_modules"),
      "dir",
    );
    const result = await run([
      "bun",
      setupSnapshotPath,
      path.join(scriptsRoot, "browser-client.mjs"),
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const line = result.stdout.trim().split(/\r?\n/u).at(-1);
    assert.notEqual(line, undefined);
    return JSON.parse(line!);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function assertCliEqual(
  name: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const [baseline, candidate] = await Promise.all([
    run(["node", path.join(baselineRoot, name), ...arguments_], {
      env: { ...process.env, ...environment },
    }),
    run(["node", path.join(candidateRoot, name), ...arguments_], {
      env: { ...process.env, ...environment },
    }),
  ]);
  assert.deepEqual(candidate, baseline, `${name} ${arguments_.join(" ")} drifted`);
}

async function verifyCliDifferentials(): Promise<void> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "browser-cli-diff-"));
  try {
    const profileRoot = path.join(fixtureRoot, "User Data", "Profile 4");
    const extensionId = "jigmpnbdhhempldjgegphdgkochgpagi";
    await mkdir(path.join(profileRoot, "Extensions", extensionId, "1.2.3"), {
      recursive: true,
    });
    const preferencesPath = path.join(profileRoot, "Preferences");
    await writeFile(
      preferencesPath,
      JSON.stringify({
        extensions: { settings: { [extensionId]: { state: 1, disable_reasons: [] } } },
      }),
    );
    const nativeManifestPath = path.join(fixtureRoot, "native-host.json");
    await writeFile(
      nativeManifestPath,
      JSON.stringify({
        name: "com.openai.codexextension.dev",
        allowed_origins: [`chrome-extension://${extensionId}/`],
      }),
    );
    await assertCliEqual("check-extension-installed.js", ["--json"], {
      CODEX_CHROME_PREFERENCES_PATH: preferencesPath,
    });
    await assertCliEqual("check-extension-installed.js", ["--bad"], {
      CODEX_CHROME_PREFERENCES_PATH: preferencesPath,
    });
    await assertCliEqual("check-native-host-manifest.js", ["--json"], {
      CODEX_CHROME_NATIVE_HOST_MANIFEST_PATH: nativeManifestPath,
    });
    await assertCliEqual("chrome-is-running.js", ["--json"], {});
    await assertCliEqual("installed-browsers.js", ["--json"], {});
    await assertCliEqual("open-chrome-window.js", ["--dry-run", "--json"], {
      CODEX_CHROME_PREFERENCES_PATH: preferencesPath,
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  assert.equal(Bun.version, "1.2.20");
  const backupManifest = objectRecord(
    JSON.parse(await readFile(backupManifestPath, "utf8")),
  );
  const backupBefore = await treeDigest(baselineRoot);
  assert.equal(backupBefore.fileCount, backupManifest.fileCount);
  assert.equal(backupBefore.sha256, backupManifest.treeSha256);

  const manifestPath = path.join(candidateRoot, "build-manifest.json");
  const manifest = objectRecord(JSON.parse(await readFile(manifestPath, "utf8")));
  assert.equal(manifest.complete, true);
  const outputs = manifest.outputs;
  assert.equal(Array.isArray(outputs), true);
  const outputNames = (outputs as unknown[])
    .map((output) => String(objectRecord(output).output))
    .sort();
  assert.deepEqual(outputNames, expectedFirstPartyOutputs);
  const dependencyPolicy = objectRecord(manifest.dependencyPolicy);
  const verifiedSourceFiles = dependencyPolicy.verifiedSourceFiles;
  assert.equal(Array.isArray(verifiedSourceFiles), true);
  for (const fileName of verifiedSourceFiles as unknown[]) {
    const value = String(fileName);
    assert.equal(value.includes("scripts-bak"), false);
    assert.equal(value.includes("tools/browser-client-recovery"), false);
    assert.equal(value.includes("components/codex-plugin/scripts/"), false);
  }

  for (const name of outputNames.filter((name) => /\.(?:m?js)$/u.test(name))) {
    const check = await run(["node", "--check", path.join(candidateRoot, name)]);
    assert.equal(check.exitCode, 0, `${name}: ${check.stderr}`);
  }
  for (const name of ["extension-id.json", "standalone-identity.json"]) {
    assert.deepEqual(
      JSON.parse(await readFile(path.join(candidateRoot, name), "utf8")),
      JSON.parse(await readFile(path.join(baselineRoot, name), "utf8")),
    );
  }

  const [baselineBrowser, candidateBrowser] = await Promise.all([
    importFresh<BrowserRuntimeModule>(path.join(baselineRoot, "browser-client.mjs")),
    importFresh<BrowserRuntimeModule>(path.join(candidateRoot, "browser-client.mjs")),
  ]);
  assert.deepEqual(Object.keys(candidateBrowser).sort(), Object.keys(baselineBrowser).sort());
  assert.deepEqual(Object.keys(candidateBrowser).sort(), ["setupBrowserRuntime"]);
  assert.equal(
    candidateBrowser.setupBrowserRuntime.length,
    baselineBrowser.setupBrowserRuntime.length,
  );
  assert.deepEqual(
    await runtimeSetupSnapshot(candidateRoot, "candidate"),
    await runtimeSetupSnapshot(baselineRoot, "baseline"),
  );

  const [baselinePolicy, candidatePolicy] = await Promise.all([
    importFresh<SiteStatusPolicyModule>(
      path.join(baselineRoot, "site-status-policy.mjs"),
    ),
    importFresh<SiteStatusPolicyModule>(
      path.join(candidateRoot, "site-status-policy.mjs"),
    ),
  ]);
  assert.deepEqual(
    await policySnapshot(candidatePolicy),
    await policySnapshot(baselinePolicy),
  );

  const [baselineInstall, candidateInstall] = await Promise.all([
    importFresh<InstallManifestModule>(path.join(baselineRoot, "installManifest.mjs")),
    importFresh<InstallManifestModule>(path.join(candidateRoot, "installManifest.mjs")),
  ]);
  assert.deepEqual(installSnapshot(candidateInstall), installSnapshot(baselineInstall));

  const [baselinePatch, candidatePatch] = await Promise.all([
    importFresh<PatchModule>(
      path.join(baselineRoot, "patch-browser-client-site-status.mjs"),
    ),
    importFresh<PatchModule>(
      path.join(candidateRoot, "patch-browser-client-site-status.mjs"),
    ),
  ]);
  const baselineBrowserSource = await readFile(
    path.join(baselineRoot, "browser-client.mjs"),
    "utf8",
  );
  const candidateBrowserSource = await readFile(
    path.join(candidateRoot, "browser-client.mjs"),
    "utf8",
  );
  assert.deepEqual(
    patchSnapshot(candidatePatch, candidateBrowserSource),
    patchSnapshot(baselinePatch, baselineBrowserSource),
  );
  for (const anchor of [
    "ensureUrlOriginConsentAllowed",
    "ensureCurrentTabFileTransferAllowed",
    "ensureFullCdpAllowed",
    "new __BossSiteStatusPolicy",
    ".throwIfBlocksUrl(",
    'siteStatus: "disabled"',
    'originAuthorization: "disabled"',
    "browser-use-runtime-policy",
    'ki("https://chatgpt.com/backend-api/aura/identity")',
  ]) {
    assert.equal(candidateBrowserSource.includes(anchor), true, `missing ${anchor}`);
  }
  assert.equal(candidateBrowserSource.includes("#browser-client-baseline"), false);
  assert.equal(
    candidateBrowserSource.includes(
      'var s6="https://chatgpt.com/backend-api",a6="agent";',
    ),
    false,
  );

  await verifyCliDifferentials();

  const signedAssetPath = path.join(
    candidateRoot,
    "node_modules/classic-level/prebuilds/darwin-x64+arm64/classic-level.node",
  );
  assert.equal(
    sha256(await readFile(signedAssetPath)),
    "e5555a5be604a47e4920bd93f8804ef33518aa1493e12709513f3bba7ee0096f",
  );

  const candidateBefore = await treeDigest(candidateRoot);
  const rebuild = await run(["bun", path.join(sourceRoot, "build/build.ts")], {
    cwd: sourceRoot,
  });
  assert.equal(rebuild.exitCode, 0, rebuild.stderr);
  const candidateAfter = await treeDigest(candidateRoot);
  assert.deepEqual(candidateAfter, candidateBefore);
  const backupAfter = await treeDigest(baselineRoot);
  assert.deepEqual(backupAfter, backupBefore);

  console.log(
    JSON.stringify(
      {
        correct: true,
        bun: Bun.version,
        immutableBaseline: backupAfter,
        candidate: candidateAfter,
        firstPartyOutputs: outputNames,
        browserRuntimeExport: "setupBrowserRuntime",
        runtimeSetupDifferential: "pass",
        cliDifferential: "pass",
        siteStatusDifferential: "pass",
        installManifestDifferential: "pass",
        patcherDifferential: "pass",
        reproducibleBuild: "pass",
        signedClassicLevelAsset: "pass",
      },
      null,
      2,
    ),
  );
}

await main();
