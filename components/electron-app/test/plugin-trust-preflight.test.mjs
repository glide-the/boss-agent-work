import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectPluginTrust, resolveUserCodexHome, sha256 } from "../src/plugin-trust-preflight.mjs";
import { resolveManualInstallPlan, reconcileManualInstall } from "../src/manual-install-environment.mjs";
import { rollbackNativeHostBackup } from "../src/native-host-backup.mjs";
const selector = "chrome-dev@codex-chrome-automation-local";
const variable = "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boss-trust-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex");
  const versionRoot = path.join(codexHome, "plugins/cache/codex-chrome-automation-local/chrome-dev/1.0.0");
  const resourcesPath = path.join(root, "resources");
  const runtimePaths = Object.fromEntries(["codexCliPath", "nodePath", "nodeReplPath"].map((key) => [key, path.join(resourcesPath, key)]));
  const clientPath = path.join(versionRoot, "scripts/browser-client.mjs");
  const client = "// boss_browser client using nodeRepl.rpc; BOSS_BROWSER_SERVICE_UNAVAILABLE";
  const service = "export async function handleRpc() {}";
  const files = {
    [path.join(versionRoot, ".codex-plugin/plugin.json")]: JSON.stringify({ name: "chrome-dev", version: "1.0.0", mcpServers: "./.mcp.json" }),
    [path.join(versionRoot, ".mcp.json")]: JSON.stringify({ mcpServers: { boss_repl: { command: runtimePaths.nodePath, args: ["./scripts/launch-browser-service.mjs"], cwd: "." } } }),
    [clientPath]: client,
    [path.join(versionRoot, "scripts/browser-service.mjs")]: service,
    [path.join(versionRoot, "scripts/launch-browser-service.mjs")]: "fixture launcher",
    [path.join(versionRoot, "extension-host", process.platform === "darwin" ? "macos" : "linux", process.arch, "extension-host")]: "fixture host",
    ...Object.fromEntries(Object.values(runtimePaths).map((file) => [file, "NODE_REPL_TRUSTED_SERVICES"])),
  };
  for (const [file, contents] of Object.entries(files)) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, contents); }
  await fs.copyFile(path.resolve(import.meta.dirname, "../../codex-plugin/scripts/installManifest.mjs"), path.join(versionRoot, "scripts/installManifest.mjs"));
  const configPath = path.join(codexHome, "config.toml");
  const config = `[marketplaces.codex-chrome-automation-local]\nsource_type = "local"\nsource = "${root}/marketplace"\n[plugins."${selector}"]\nenabled = true\n[plugins."official@official"]\nenabled = true\n[shell_environment_policy.set]\n${variable} = "${sha256(client)}"\n`;
  await fs.writeFile(configPath, config);
  const serviceProbe = async () => ({ authorized: true, nativePipeAvailable: true, protocolVersion: 1, service: "boss_browser" });
  const configWriter = async () => {
    const current = await fs.readFile(configPath, "utf8");
    if (current.includes('[plugins."chrome-dev@codex-chrome-automation-local".mcp_servers.boss_repl.tools.js]')) {
      return { changed: false, configPath };
    }
    await fs.writeFile(configPath, `${current}\n[plugins."chrome-dev@codex-chrome-automation-local".mcp_servers.boss_repl.tools.js]\napproval_mode = "approve"\n`);
    return { changed: true, configPath };
  };
  const input = { codexHome, versionRoot, resourcesPath, homeDirectory: root, runtimePaths, environment: {}, serviceProbe, configWriter, ...runtimePaths };
  return { root, input, clientPath, configPath, config };
}

test("private expected fingerprint is comparison only; explicit value wins and user config is unchanged", async (t) => {
  const f = await fixture(t);
  const a = await inspectPluginTrust(f.input);
  assert.equal(a.ready, true);
  assert.equal(a.effectiveTrust, "isolated-service-authorized");
  assert.equal(a.mcpApproval.configured, false);
  assert.ok(a.warnings.some((x) => x.code === "MCP_TOOL_APPROVAL_REQUIRED"));
  const b = await inspectPluginTrust({ ...f.input, environment: { BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256: "0".repeat(64) } });
  assert.ok(b.issues.some((x) => x.code === "FINGERPRINT_MISMATCH"));
  const c = await inspectPluginTrust({ ...f.input, expectedBrowserClientSha256: a.fingerprint, environment: { BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256: "invalid" } });
  assert.equal(c.ready, true);
  await fs.appendFile(f.clientPath, "\n// upgrade");
  const d = await inspectPluginTrust({ ...f.input, expectedBrowserClientSha256: a.fingerprint });
  assert.ok(d.issues.some((x) => x.code === "FINGERPRINT_MISMATCH"));
  assert.equal(await fs.readFile(f.configPath, "utf8"), f.config);
});

test("missing, disabled, invalid TOML and redirected identity fail with distinct diagnostics", async (t) => {
  const f = await fixture(t);
  assert.equal((await inspectPluginTrust({ ...f.input, versionRoot: null })).issues[0].code, "PLUGIN_NOT_INSTALLED");
  await fs.writeFile(f.configPath, f.config.replace('enabled = true', 'enabled = false'));
  assert.ok((await inspectPluginTrust(f.input)).issues.some((x) => x.code === "PLUGIN_DISABLED"));
  await fs.writeFile(f.configPath, "invalid = [");
  assert.equal((await inspectPluginTrust(f.input)).issues[0].code, "USER_CONFIG_ERROR");
  const outside = path.join(f.root, "outside");
  await fs.rename(f.input.versionRoot, outside);
  await fs.symlink(outside, f.input.versionRoot);
  assert.equal((await inspectPluginTrust(f.input)).issues[0].code, "CONFIG_CONFLICT");
});

test("boss_repl remains callable from Codex code mode", async (t) => {
  const f = await fixture(t);
  const mcpPath = path.join(f.input.versionRoot, ".mcp.json");
  const mcp = JSON.parse(await fs.readFile(mcpPath, "utf8"));
  mcp.mcpServers.boss_repl.omit_tools_from = ["code_mode"];
  await fs.writeFile(mcpPath, JSON.stringify(mcp));
  const report = await inspectPluginTrust(f.input);
  assert.equal(report.ready, false);
  assert.ok(report.issues.some((issue) => issue.code === "CONFIG_CONFLICT"));
});

test("explicit boss_repl MCP denials are conflicts and are not replaced", async (t) => {
  const f = await fixture(t);
  await fs.appendFile(f.configPath, `\n[plugins."${selector}".mcp_servers.boss_repl.tools.js]\napproval_mode = "prompt"\n`);
  const report = await inspectPluginTrust(f.input);
  assert.equal(report.ready, false);
  assert.ok(report.issues.some((issue) => issue.code === "MCP_TOOL_APPROVAL_CONFLICT"));
  await assert.rejects(reconcileManualInstall(await resolveManualInstallPlan(f.input)), /MCP_TOOL_APPROVAL_CONFLICT/);
  assert.equal(await fs.readFile(f.configPath, "utf8"), `${f.config}\n[plugins."${selector}".mcp_servers.boss_repl.tools.js]\napproval_mode = "prompt"\n`);
});

test("legacy host variables are diagnostic only for the authorized isolated service", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.configPath, f.config.replace(sha256(await fs.readFile(f.clientPath)), "0".repeat(64)));
  assert.equal((await inspectPluginTrust(f.input)).ready, true);
  const r = await inspectPluginTrust({ ...f.input, environment: { [variable]: "1".repeat(64) } });
  assert.ok(r.warnings.some((x) => x.code === "LEGACY_TRUST_CONFLICT"));
  assert.ok((await inspectPluginTrust({ ...f.input, environment: { [variable]: "garbage" } })).warnings.some((x) => x.code === "LEGACY_TRUST_INVALID"));
});

test("service runtime requires a successful host handshake and legacy runtime cannot use the old allowlist as fallback", async (t) => {
  const f = await fixture(t);
  const current = await inspectPluginTrust(f.input);
  assert.equal(current.ready, true);
  assert.equal(current.effectiveTrust, "isolated-service-authorized");
  const denied = await inspectPluginTrust({ ...f.input, serviceProbe: async () => { throw new Error("denied"); } });
  assert.ok(denied.issues.some((x) => x.code === "PLUGIN_UNTRUSTED"));
  await fs.writeFile(f.input.runtimePaths.nodeReplPath, variable);
  const legacy = await inspectPluginTrust(f.input);
  assert.equal(legacy.recorded, true);
  assert.equal(legacy.ready, false);
  assert.ok(legacy.issues.some((x) => x.code === "RUNTIME_INCOMPATIBLE"));
  await assert.rejects(reconcileManualInstall(await resolveManualInstallPlan(f.input)), /RUNTIME_INCOMPATIBLE/);
  await assert.rejects(fs.access(path.join(f.input.codexHome, "backups")), { code: "ENOENT" });
  await fs.writeFile(f.input.runtimePaths.nodeReplPath, "unknown");
  assert.ok((await inspectPluginTrust(f.input)).issues.some((x) => x.code === "RUNTIME_INCOMPATIBLE"));
});

test("CODEX_HOME resolves explicit > supplied environment > home and rejects invalid environment roots", () => {
  const base = { homeDirectory: "/tmp/home", environment: { CODEX_HOME: "/tmp/env" } };
  assert.equal(resolveUserCodexHome(base), "/tmp/env");
  assert.equal(resolveUserCodexHome({ ...base, codexHome: "/tmp/explicit" }), "/tmp/explicit");
  assert.equal(resolveUserCodexHome({ ...base, environment: {} }), "/tmp/home/.codex");
  for (const value of ["", "relative", "/"]) assert.throws(() => resolveUserCodexHome({ ...base, environment: { CODEX_HOME: value } }), /INVALID_ENVIRONMENT/);
});

test("first registration, idempotence, unrelated entry preservation and guarded rollback", async (t) => {
  const f = await fixture(t);
  const registry = path.join(f.input.codexHome, "chrome-native-hosts-v2.json");
  const original = JSON.stringify({ schemaVersion: 2, entries: [{ entryId: "official", nativeHostNames: ["com.openai.codexextension"] }] });
  await fs.writeFile(registry, original);
  const plan = await resolveManualInstallPlan(f.input);
  assert.equal(plan.ready, true);
  const first = await reconcileManualInstall(plan);
  assert.equal(first.connectionVerified, false);
  const configured = await fs.readFile(f.configPath, "utf8");
  const parsedConfig = Bun.TOML.parse(configured);
  assert.equal(parsedConfig.plugins[selector].mcp_servers.boss_repl.tools.js.approval_mode, "approve");
  assert.equal(parsedConfig.plugins["official@official"].enabled, true);
  const registered = await fs.readFile(registry, "utf8");
  assert.equal(JSON.parse(registered).entries.find((x) => x.entryId === "official").nativeHostNames[0], "com.openai.codexextension");
  const second = await reconcileManualInstall(plan);
  assert.equal(await fs.readFile(registry, "utf8"), registered);
  assert.equal(await fs.readFile(f.configPath, "utf8"), configured);
  await fs.writeFile(registry, registered + " ");
  await assert.rejects(rollbackNativeHostBackup(second.backupPath), /changed after initialization/);
  await fs.writeFile(registry, registered);
  await rollbackNativeHostBackup(second.backupPath);
  assert.equal(await fs.readFile(f.configPath, "utf8"), configured);
  await rollbackNativeHostBackup(first.backupPath);
  await rollbackNativeHostBackup(first.backupPath);
  assert.equal(await fs.readFile(registry, "utf8"), original);
  assert.equal(await fs.readFile(f.configPath, "utf8"), f.config);
});

test("malformed registry and drift between plan and initialization fail before mutation", async (t) => {
  const f = await fixture(t);
  const registry = path.join(f.input.codexHome, "chrome-native-hosts-v2.json");
  const plan = await resolveManualInstallPlan(f.input);
  await fs.writeFile(registry, "broken json");
  await assert.rejects(reconcileManualInstall(plan), /CONFIG_CONFLICT/);
  assert.equal(await fs.readFile(registry, "utf8"), "broken json");
  await fs.unlink(registry);
  await fs.appendFile(f.clientPath, "changed after inspection");
  await assert.rejects(reconcileManualInstall(plan), /FINGERPRINT_MISMATCH/);
  await assert.rejects(fs.access(path.join(f.input.codexHome, "backups")), { code: "ENOENT" });
});
