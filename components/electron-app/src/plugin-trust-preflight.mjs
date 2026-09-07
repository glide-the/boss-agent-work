import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { bossPluginCacheRoot, bossPluginIdentity } from "./boss-plugin-native-host-lifecycle.mjs";

export const expectedFingerprintVariable = "BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256";
export const browserClientTrustVariable = "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S";
const selector = `${bossPluginIdentity.pluginName}@${bossPluginIdentity.marketplaceName}`;
const digestPattern = /^[a-f0-9]{64}$/i;
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const issue = (code, message) => ({ code, message });

async function runInstalledServiceProbe({ versionRoot, runtimePaths, environment }) {
  if (!globalThis.Bun?.spawn) {
    throw new Error("Run the personal service authorization probe with Bun.");
  }
  const launcherPath = path.join(versionRoot, "scripts", "launch-browser-service.mjs");
  const child = Bun.spawn([runtimePaths.nodePath, launcherPath, "--probe"], {
    env: {
      ...process.env,
      ...environment,
      BOSS_PLUGIN_NODE_PATH: runtimePaths.nodePath,
      BOSS_PLUGIN_NODE_REPL_PATH: runtimePaths.nodeReplPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `probe exited ${exitCode}`);
  }
  const line = stdout.trim().split(/\r?\n/u).at(-1);
  const result = JSON.parse(line ?? "{}");
  if (result.authorized !== true || result.nativePipeAvailable !== true ||
      result.service !== "boss_browser" || result.protocolVersion !== 1) {
    throw new Error("node_repl did not authorize the isolated boss_browser service.");
  }
  return result;
}

export function resolveUserCodexHome({ codexHome, environment = process.env, homeDirectory }) {
  const value = codexHome ?? environment.CODEX_HOME ?? path.join(homeDirectory, ".codex");
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value) || path.resolve(value) === path.parse(path.resolve(value)).root) {
    throw new Error("INVALID_ENVIRONMENT: CODEX_HOME must be a non-empty absolute user directory, not a filesystem root.");
  }
  return path.resolve(value);
}

function parseHashes(value, location) {
  if (value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${location} must be a comma-separated SHA-256 string.`);
  if (!value.trim()) return [];
  const values = value.split(",").map((entry) => entry.trim().toLowerCase());
  if (values.some((entry) => !digestPattern.test(entry))) throw new Error(`${location} contains an invalid SHA-256 value.`);
  return [...new Set(values)].sort();
}

/** Read-only evidence, never a substitute for the running host's trust decision. */
export async function inspectPluginTrust({ codexHome, versionRoot, runtimePaths, environment = process.env, expectedBrowserClientSha256, serviceProbe = runInstalledServiceProbe }) {
  expectedBrowserClientSha256 ??= environment[expectedFingerprintVariable];
  const report = { pluginId: selector, configPath: path.join(codexHome, "config.toml"), issues: [], warnings: [], ready: false,
    effectiveTrust: "unverified", fingerprint: null, recorded: false, runtime: "unknown" };
  const add = (code, message) => report.issues.push(issue(code, message));
  const warn = (code, message) => report.warnings.push(issue(code, message));
  if (expectedBrowserClientSha256 !== undefined && !digestPattern.test(expectedBrowserClientSha256)) {
    add("INVALID_ENVIRONMENT", "--expected-browser-client-sha256 / BOSS_PLUGIN_EXPECTED_BROWSER_CLIENT_SHA256 must contain exactly 64 hexadecimal characters.");
    return report;
  }
  if (!versionRoot) {
    add("PLUGIN_NOT_INSTALLED", `Install ${selector} using codex plugin add after registering its local marketplace.`);
    return report;
  }
  let clientBytes;
  let serviceBytes;
  try {
    const cacheRoot = bossPluginCacheRoot(codexHome);
    const realRoot = await fs.realpath(versionRoot);
    if (path.dirname(path.resolve(versionRoot)) !== cacheRoot || path.basename(versionRoot) === "latest" ||
        path.dirname(realRoot) !== await fs.realpath(cacheRoot)) {
      throw new Error("Plugin version must be a direct, non-redirected member of the personal marketplace cache.");
    }
    const manifest = JSON.parse(await fs.readFile(path.join(versionRoot, ".codex-plugin/plugin.json"), "utf8"));
    if (manifest.name !== bossPluginIdentity.pluginName || manifest.version !== path.basename(versionRoot) ||
        manifest.mcpServers !== "./.mcp.json") {
      throw new Error("Plugin name/version does not match the selected personal cache directory.");
    }
    report.version = manifest.version;
    const clientPath = path.join(versionRoot, "scripts/browser-client.mjs");
    if (!((await fs.realpath(clientPath)).startsWith(`${realRoot}${path.sep}`))) throw new Error("Browser Client escapes the installed plugin directory.");
    clientBytes = await fs.readFile(clientPath);
    const servicePath = path.join(versionRoot, "scripts/browser-service.mjs");
    const launcherPath = path.join(versionRoot, "scripts/launch-browser-service.mjs");
    const mcpPath = path.join(versionRoot, ".mcp.json");
    serviceBytes = await fs.readFile(servicePath);
    await fs.access(launcherPath);
    const mcp = JSON.parse(await fs.readFile(mcpPath, "utf8"));
    const bossRepl = mcp?.mcpServers?.boss_repl;
    if (bossRepl?.command !== runtimePaths.nodePath || bossRepl?.cwd !== "." ||
        !Array.isArray(bossRepl.args) || bossRepl.args.length !== 1 ||
        bossRepl.args[0] !== "./scripts/launch-browser-service.mjs" ||
        (Array.isArray(bossRepl.omit_tools_from) && bossRepl.omit_tools_from.includes("code_mode"))) {
      throw new Error("Personal .mcp.json must declare the isolated boss_repl launcher and expose it to Codex code mode.");
    }
    const clientUsesPersonalRpc = clientBytes.includes(Buffer.from("boss_browser")) &&
      clientBytes.includes(Buffer.from("BOSS_BROWSER_SERVICE_UNAVAILABLE"));
    const serviceHasRpcEntry = serviceBytes.includes(Buffer.from("handleRpc"));
    if (!clientUsesPersonalRpc || !serviceHasRpcEntry) {
      throw new Error("Personal Browser Client and service protocol markers are incomplete.");
    }
    report.service = { mcpServer: "boss_repl", rpcService: "boss_browser", clientUsesPersonalRpc, serviceHasRpcEntry };
    report.fingerprint = sha256(clientBytes);
    if (expectedBrowserClientSha256 !== undefined && expectedBrowserClientSha256.toLowerCase() !== report.fingerprint) {
      add("FINGERPRINT_MISMATCH", "Installed Browser Client differs from the expected release digest. Review the changed artifact before initializing.");
    }
  } catch (error) {
    add(error.code === "ENOENT" ? "PLUGIN_NOT_INSTALLED" : "CONFIG_CONFLICT", error.message);
    return report;
  }
  let config;
  try {
    if (!globalThis.Bun?.TOML?.parse) throw new Error("Run this read-only TOML preflight with Bun.");
    config = Bun.TOML.parse(await fs.readFile(report.configPath, "utf8"));
  } catch (error) {
    add("USER_CONFIG_ERROR", `Cannot read/parse ${report.configPath} (${error.code ?? "invalid TOML or unavailable Bun parser"}).`);
    return report;
  }
  if (config.plugins?.[selector]?.enabled !== true) add("PLUGIN_DISABLED", `User config must enable ${selector} through the supported plugin installer.`);
  const mcpPolicy = config.plugins?.[selector]?.mcp_servers?.boss_repl;
  const explicitApproval = mcpPolicy?.tools?.js?.approval_mode;
  const effectiveApproval = explicitApproval ?? mcpPolicy?.default_tools_approval_mode;
  report.mcpApproval = {
    configured: effectiveApproval === "approve",
    keyPath: `plugins."${selector}".mcp_servers.boss_repl.tools.js.approval_mode`,
    mode: effectiveApproval ?? null,
  };
  if (mcpPolicy?.enabled === false) {
    add("MCP_SERVER_DISABLED", "User config explicitly disables the personal boss_repl MCP server.");
  }
  if (Array.isArray(mcpPolicy?.enabled_tools) && !mcpPolicy.enabled_tools.includes("js") ||
      Array.isArray(mcpPolicy?.disabled_tools) && mcpPolicy.disabled_tools.includes("js")) {
    add("MCP_TOOL_DISABLED", "User config explicitly disables the personal boss_repl js tool.");
  }
  if (effectiveApproval == null) {
    warn("MCP_TOOL_APPROVAL_REQUIRED", "Initialization will authorize only the personal boss_repl js tool in the user Codex config.");
  } else if (effectiveApproval !== "approve") {
    add("MCP_TOOL_APPROVAL_CONFLICT", `User config sets boss_repl js approval_mode to ${JSON.stringify(effectiveApproval)}; refusing to replace an explicit policy.`);
  }
  const marketplace = config.marketplaces?.[bossPluginIdentity.marketplaceName];
  if (marketplace?.source_type !== "local" || typeof marketplace.source !== "string" || !path.isAbsolute(marketplace.source)) {
    add("CONFIG_CONFLICT", "The personal marketplace must have an absolute local source in user config.");
  }
  try {
    const sources = [
      ["shell_environment_policy.set", config.shell_environment_policy?.set?.[browserClientTrustVariable]],
      ["mcp_servers.node_repl.env", config.mcp_servers?.node_repl?.env?.[browserClientTrustVariable]],
      ["process environment", environment[browserClientTrustVariable]],
    ].map(([name, value]) => ({ name, hashes: parseHashes(value, name) })).filter(({ hashes }) => hashes !== null);
    report.trustSources = sources.map(({ name, hashes }) => ({ name, containsCurrentFingerprint: hashes.includes(report.fingerprint) }));
    if (new Set(sources.map(({ hashes }) => JSON.stringify(hashes))).size > 1) {
      warn("LEGACY_TRUST_CONFLICT", "Legacy Browser Client allowlists disagree across shell, MCP, or process environment. The isolated boss_repl removes this variable before starting node_repl.");
    }
    report.recorded = sources.length > 0 && sources.every(({ hashes }) => hashes.includes(report.fingerprint));
  } catch (error) { warn("LEGACY_TRUST_INVALID", error.message); }
  try {
    const runtimeBytes = await fs.readFile(runtimePaths.nodeReplPath);
    const legacy = runtimeBytes.includes(Buffer.from(browserClientTrustVariable));
    const services = runtimeBytes.includes(Buffer.from("NODE_REPL_TRUSTED_SERVICES"));
    report.runtime = legacy ? "legacy-hash-marker" : services ? "service-marker" : "unknown";
    report.runtimeEvidence = "binary capability marker plus isolated service authorization handshake";
    if (!services) {
      add("RUNTIME_INCOMPATIBLE", "The personal boss_repl requires NODE_REPL_TRUSTED_SERVICES support. The legacy hash allowlist is not a fallback.");
    } else {
      try {
        report.serviceProbe = await serviceProbe({ versionRoot, runtimePaths, environment });
        report.effectiveTrust = "isolated-service-authorized";
      } catch (error) {
        add("PLUGIN_UNTRUSTED", `The host did not authorize the isolated boss_browser service: ${error.message}`);
      }
    }
  } catch (error) { add("RUNTIME_UNVERIFIED", `Cannot inspect the selected runtime: ${error.message}`); }
  for (const policyPath of ["/etc/codex/requirements.toml", "/etc/codex/managed_config.toml", "/Library/Managed Preferences/com.google.Chrome.plist", "/Library/Managed Preferences/com.openai.codex.plist"]) {
    try {
      await fs.access(policyPath);
      add("POLICY_REVIEW_REQUIRED", `Managed configuration exists at ${policyPath}; use the host to establish permission. This is not a claim that policy has denied the plugin.`);
    } catch (error) { if (error.code !== "ENOENT") add("POLICY_REVIEW_REQUIRED", `Cannot inspect managed configuration at ${policyPath}.`); }
  }
  report.ready = report.issues.length === 0;
  return report;
}
