import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export const bossBrowserServiceName = "boss_browser";
export const legacyBrowserClientTrustVariable =
  "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S";

interface NodeReplRpc {
  rpc?: (service: string, request: unknown) => Promise<unknown>;
}

export type BossBrowserRpc = (
  method: "setup" | "execute",
  params: unknown,
) => Promise<unknown>;

export function createBossBrowserRpc(
  globals: Record<string, unknown>,
): BossBrowserRpc {
  const nodeRepl = globals.nodeRepl as NodeReplRpc | undefined;
  if (typeof nodeRepl?.rpc !== "function") {
    throw new Error(
      "BOSS_BROWSER_SERVICE_UNAVAILABLE: Boss投递 requires its isolated boss_repl service. " +
        "Use the Boss投递 MCP JavaScript tool; changing NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S cannot initialize this runtime.",
    );
  }
  const rpc = nodeRepl.rpc.bind(nodeRepl);
  return async (method, params) => {
    try {
      return await rpc(bossBrowserServiceName, { method, params });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `BOSS_BROWSER_SERVICE_UNAVAILABLE: ${message}. ` +
          "Start the plugin-provided boss_repl service; do not add a legacy Browser Client hash.",
        { cause: error },
      );
    }
  };
}

export interface PersonalBrowserLaunchPlan {
  executable: string;
  environment: NodeJS.ProcessEnv;
  pluginRoot: string;
  servicePath: string;
}

function pathList(values: Array<string | undefined>): string {
  return [...new Set(values.flatMap((value) => value?.split(path.delimiter) ?? []).filter(Boolean))]
    .join(path.delimiter);
}

export async function createPersonalBrowserLaunchPlan(options: {
  environment?: NodeJS.ProcessEnv;
  pluginRoot: string;
  platform?: NodeJS.Platform;
}): Promise<PersonalBrowserLaunchPlan> {
  const environment = { ...(options.environment ?? process.env) };
  const pluginRoot = path.resolve(options.pluginRoot);
  const platform = options.platform ?? process.platform;
  const executableCandidates = [
    environment.BOSS_PLUGIN_NODE_REPL_PATH,
    platform === "darwin"
      ? "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl"
      : undefined,
    platform === "darwin"
      ? "/Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl"
      : undefined,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  let executable: string | null = null;
  for (const candidate of executableCandidates) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      await access(candidate);
      executable = candidate;
      break;
    } catch {}
  }
  if (executable === null) {
    throw new Error(
      "BOSS_NODE_REPL_NOT_FOUND: set BOSS_PLUGIN_NODE_REPL_PATH to the current Desktop node_repl executable.",
    );
  }

  const scriptsRoot = path.join(pluginRoot, "scripts");
  const servicePath = path.join(scriptsRoot, "browser-service.mjs");
  const clientPath = path.join(scriptsRoot, "browser-client.mjs");
  await Promise.all([access(servicePath), access(clientPath)]);
  const resourcesRoot = path.resolve(executable, "../../..");
  const nodePath =
    environment.BOSS_PLUGIN_NODE_PATH ?? path.join(resourcesRoot, "cua_node", "bin", "node");
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
    environment.NODE_REPL_NODE_MODULE_DIRS,
  ]);
  environment.NODE_REPL_TRUSTED_CODE_PATHS = pathList([
    pluginRoot,
    environment.NODE_REPL_TRUSTED_CODE_PATHS,
  ]);
  environment.NODE_REPL_TRUSTED_SERVICES = JSON.stringify({
    [bossBrowserServiceName]: servicePath,
  });
  environment.BROWSER_USE_AVAILABLE_BACKENDS = "chrome";
  environment.NODE_REPL_JS_BANNER = [
    `const { setupBrowserRuntime } = await import(${JSON.stringify(clientUrl)});`,
    "if (globalThis.agent?.browsers == null) await setupBrowserRuntime({ globals: globalThis, elicitationDisplayName: 'Boss投递' });",
  ].join("\n");
  environment.NODE_REPL_TOOL_OVERRIDES = JSON.stringify({
    server_instructions:
      "Persistent JavaScript runtime for the isolated Boss投递 Chrome plugin.",
    tools: {
      js: {
        description:
          "Run JavaScript against the isolated Boss投递 browser runtime. The personal boss_browser service is initialized before the first call.",
      },
    },
  });

  return { executable, environment, pluginRoot, servicePath };
}

interface McpResponse {
  id?: number;
  error?: { message?: string };
  result?: unknown;
}

export async function probePersonalBrowserService(
  plan: PersonalBrowserLaunchPlan,
  timeoutMs = 15_000,
): Promise<{
  authorized: true;
  nativePipeAvailable: true;
  nonce: string;
  protocolVersion: 1;
  service: typeof bossBrowserServiceName;
}> {
  const child = spawn(plan.executable, [], {
    env: plan.environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdoutBuffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map<
    number,
    { reject(error: Error): void; resolve(response: McpResponse): void }
  >();
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let response: McpResponse;
      try {
        response = JSON.parse(line) as McpResponse;
      } catch {
        continue;
      }
      if (typeof response.id !== "number") continue;
      const waiter = pending.get(response.id);
      if (waiter == null) continue;
      pending.delete(response.id);
      if (response.error != null) {
        waiter.reject(new Error(response.error.message ?? "MCP request failed"));
      } else waiter.resolve(response);
    }
  });
  const request = (method: string, params: unknown): Promise<McpResponse> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  const terminate = (): void => {
    if (!child.killed) child.kill("SIGTERM");
  };
  const timeout = setTimeout(() => {
    const error = new Error(
      `BOSS_SERVICE_PROBE_TIMEOUT: personal service did not answer within ${timeoutMs}ms. ${stderr}`,
    );
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    terminate();
  }, timeoutMs);
  timeout.unref();

  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "boss-plugin-trust-probe", version: "1" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
    );
    const nonce = randomUUID();
    const code =
      `nodeRepl.write(await nodeRepl.rpc(${JSON.stringify(bossBrowserServiceName)}, ` +
      `{method:"ping",params:{nonce:${JSON.stringify(nonce)}}}))`;
    const response = await request("tools/call", {
      name: "js",
      arguments: { code, timeout_ms: Math.max(1000, timeoutMs - 1000) },
    });
    const result = response.result as
      | { content?: Array<{ text?: string }>; isError?: boolean }
      | undefined;
    if (result?.isError === true) {
      throw new Error(
        `BOSS_SERVICE_PROBE_FAILED: ${result.content?.map((item) => item.text ?? "").join(" ")}`,
      );
    }
    const text = result?.content?.map((item) => item.text ?? "").join("\n") ?? "";
    if (
      !text.includes(nonce) ||
      !text.includes(bossBrowserServiceName) ||
      !(
        text.includes('"nativePipeAvailable":true') ||
        /nativePipeAvailable:\s*true/u.test(text)
      )
    ) {
      throw new Error(
        `BOSS_SERVICE_PROBE_FAILED: the host did not confirm the personal service and privileged pipe. ${text}`,
      );
    }
    return {
      authorized: true,
      nativePipeAvailable: true,
      nonce,
      protocolVersion: 1,
      service: bossBrowserServiceName,
    };
  } finally {
    clearTimeout(timeout);
    terminate();
  }
}
