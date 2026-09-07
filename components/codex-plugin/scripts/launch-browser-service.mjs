#!/usr/bin/env node

// scripts/launch-browser-service.ts
import { spawn as spawn2 } from "node:child_process";
import path2 from "node:path";

// runtime/trusted-service.ts
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
var bossBrowserServiceName = "boss_browser";
var legacyBrowserClientTrustVariable = "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S";
function pathList(values) {
  return [...new Set(values.flatMap((value) => value?.split(path.delimiter) ?? []).filter(Boolean))].join(path.delimiter);
}
async function createPersonalBrowserLaunchPlan(options) {
  const environment = { ...options.environment ?? process.env };
  const pluginRoot = path.resolve(options.pluginRoot);
  const platform = options.platform ?? process.platform;
  const executableCandidates = [
    environment.BOSS_PLUGIN_NODE_REPL_PATH,
    platform === "darwin" ? "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl" : undefined,
    platform === "darwin" ? "/Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl" : undefined
  ].filter((value) => typeof value === "string" && value.length > 0);
  let executable = null;
  for (const candidate of executableCandidates) {
    if (!path.isAbsolute(candidate))
      continue;
    try {
      await access(candidate);
      executable = candidate;
      break;
    } catch {}
  }
  if (executable === null) {
    throw new Error("BOSS_NODE_REPL_NOT_FOUND: set BOSS_PLUGIN_NODE_REPL_PATH to the current Desktop node_repl executable.");
  }
  const scriptsRoot = path.join(pluginRoot, "scripts");
  const servicePath = path.join(scriptsRoot, "browser-service.mjs");
  const clientPath = path.join(scriptsRoot, "browser-client.mjs");
  await Promise.all([access(servicePath), access(clientPath)]);
  const resourcesRoot = path.resolve(executable, "../../..");
  const nodePath = environment.BOSS_PLUGIN_NODE_PATH ?? path.join(resourcesRoot, "cua_node", "bin", "node");
  if (!path.isAbsolute(nodePath)) {
    throw new Error("BOSS_PLUGIN_NODE_PATH must be absolute when set.");
  }
  await access(nodePath);
  delete environment[legacyBrowserClientTrustVariable];
  const clientUrl = pathToFileURL(clientPath).href;
  environment.CODEX_HOME ??= path.join(process.env.HOME ?? pluginRoot, ".codex");
  environment.NODE_REPL_NODE_PATH = nodePath;
  environment.NODE_REPL_NODE_MODULE_DIRS = pathList([
    scriptsRoot,
    path.join(resourcesRoot, "cua_node", "lib", "node_modules"),
    environment.NODE_REPL_NODE_MODULE_DIRS
  ]);
  environment.NODE_REPL_TRUSTED_CODE_PATHS = pathList([
    pluginRoot,
    environment.NODE_REPL_TRUSTED_CODE_PATHS
  ]);
  environment.NODE_REPL_TRUSTED_SERVICES = JSON.stringify({
    [bossBrowserServiceName]: servicePath
  });
  environment.BROWSER_USE_AVAILABLE_BACKENDS = "chrome";
  environment.NODE_REPL_JS_BANNER = [
    `const { setupBrowserRuntime } = await import(${JSON.stringify(clientUrl)});`,
    "if (globalThis.agent?.browsers == null) await setupBrowserRuntime({ globals: globalThis, elicitationDisplayName: 'Boss投递' });"
  ].join(`
`);
  environment.NODE_REPL_TOOL_OVERRIDES = JSON.stringify({
    server_instructions: "Persistent JavaScript runtime for the isolated Boss投递 Chrome plugin.",
    tools: {
      js: {
        description: "Run JavaScript against the isolated Boss投递 browser runtime. The personal boss_browser service is initialized before the first call."
      }
    }
  });
  return { executable, environment, pluginRoot, servicePath };
}
async function probePersonalBrowserService(plan, timeoutMs = 15000) {
  const child = spawn(plan.executable, [], {
    env: plan.environment,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdoutBuffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map;
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    for (;; ) {
      const newline = stdoutBuffer.indexOf(`
`);
      if (newline < 0)
        break;
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line)
        continue;
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof response.id !== "number")
        continue;
      const waiter = pending.get(response.id);
      if (waiter == null)
        continue;
      pending.delete(response.id);
      if (response.error != null) {
        waiter.reject(new Error(response.error.message ?? "MCP request failed"));
      } else
        waiter.resolve(response);
    }
  });
  const request = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}
`);
    });
  };
  const terminate = () => {
    if (!child.killed)
      child.kill("SIGTERM");
  };
  const timeout = setTimeout(() => {
    const error = new Error(`BOSS_SERVICE_PROBE_TIMEOUT: personal service did not answer within ${timeoutMs}ms. ${stderr}`);
    for (const waiter of pending.values())
      waiter.reject(error);
    pending.clear();
    terminate();
  }, timeoutMs);
  timeout.unref();
  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "boss-plugin-trust-probe", version: "1" }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}
`);
    const nonce = randomUUID();
    const code = `nodeRepl.write(await nodeRepl.rpc(${JSON.stringify(bossBrowserServiceName)}, ` + `{method:"ping",params:{nonce:${JSON.stringify(nonce)}}}))`;
    const response = await request("tools/call", {
      name: "js",
      arguments: { code, timeout_ms: Math.max(1000, timeoutMs - 1000) }
    });
    const result = response.result;
    if (result?.isError === true) {
      throw new Error(`BOSS_SERVICE_PROBE_FAILED: ${result.content?.map((item) => item.text ?? "").join(" ")}`);
    }
    const text = result?.content?.map((item) => item.text ?? "").join(`
`) ?? "";
    if (!text.includes(nonce) || !text.includes(bossBrowserServiceName) || !(text.includes('"nativePipeAvailable":true') || /nativePipeAvailable:\s*true/u.test(text))) {
      throw new Error(`BOSS_SERVICE_PROBE_FAILED: the host did not confirm the personal service and privileged pipe. ${text}`);
    }
    return {
      authorized: true,
      nativePipeAvailable: true,
      nonce,
      protocolVersion: 1,
      service: bossBrowserServiceName
    };
  } finally {
    clearTimeout(timeout);
    terminate();
  }
}

// scripts/launch-browser-service.ts
var pluginRoot = path2.resolve(import.meta.dirname, "..");
try {
  const plan = await createPersonalBrowserLaunchPlan({ pluginRoot });
  if (process.argv.slice(2).includes("--probe")) {
    const result = await probePersonalBrowserService(plan);
    console.log(JSON.stringify(result));
    process.exit(0);
  }
  const child = spawn2(plan.executable, [], { env: plan.environment, stdio: "inherit" });
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const forwardSignal = (signal) => {
    child.kill(signal);
  };
  for (const signal of signals)
    process.on(signal, forwardSignal);
  child.once("error", (error) => {
    console.error(`Boss投递 runtime could not start: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    for (const name of signals)
      process.off(name, forwardSignal);
    if (signal !== null)
      process.kill(process.pid, signal);
    else
      process.exitCode = code !== null && code >= 0 ? code : 1;
  });
} catch (error) {
  console.error(`Boss投递 runtime could not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
