import { spawn } from "node:child_process";
import path from "node:path";

const pluginSelector = "chrome-dev@codex-chrome-automation-local";
const approvalKeyPath =
  `plugins."${pluginSelector}".mcp_servers.boss_repl.tools.js.approval_mode`;

function appServerClient(command, environment, timeoutMs) {
  const child = spawn(command, ["app-server", "--listen", "stdio://"], {
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  let stdout = "";
  let stderr = "";

  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-2_000);
  });
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
    for (;;) {
      const newline = stdout.indexOf("\n");
      if (newline < 0) break;
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (!line) continue;
      let response;
      try { response = JSON.parse(line); } catch { continue; }
      const request = pending.get(response.id);
      if (request == null) continue;
      pending.delete(response.id);
      clearTimeout(request.timer);
      if (response.error != null) {
        request.reject(new Error(response.error.message ?? "Codex App Server request failed."));
      } else request.resolve(response.result);
    }
  });
  child.once("error", (error) => rejectPending(error));
  child.once("exit", (code) => {
    if (pending.size > 0) {
      rejectPending(new Error(`Codex App Server exited ${code ?? "without a status"}. ${stderr}`.trim()));
    }
  });

  const request = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex App Server timed out while calling ${method}. ${stderr}`.trim()));
      }, timeoutMs);
      timer.unref();
      pending.set(id, { reject, resolve, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };
  const close = () => {
    rejectPending(new Error("Codex App Server client closed."));
    child.stdin.end();
    if (child.exitCode == null && !child.killed) child.kill("SIGTERM");
  };
  return { close, notify, request };
}

export async function writeBossPluginMcpApproval({
  codexCliPath,
  codexHome,
  environment = process.env,
  timeoutMs = 15_000,
}) {
  const configPath = path.join(codexHome, "config.toml");
  const client = appServerClient(codexCliPath, { ...environment, CODEX_HOME: codexHome }, timeoutMs);
  try {
    await client.request("initialize", {
      clientInfo: { name: "boss-personal-plugin-initializer", version: "1.0.0" },
    });
    client.notify("initialized", {});
    const read = await client.request("config/read", { includeLayers: true });
    const userLayer = read?.layers?.find((layer) =>
      layer?.name?.type === "user" && path.resolve(layer.name.file) === path.resolve(configPath));
    if (typeof userLayer?.version !== "string") {
      throw new Error("USER_CONFIG_ERROR: Codex App Server did not report the selected user config layer.");
    }
    const result = await client.request("config/batchWrite", {
      edits: [{ keyPath: approvalKeyPath, mergeStrategy: "upsert", value: "approve" }],
      expectedVersion: userLayer.version,
      filePath: configPath,
      reloadUserConfig: false,
    });
    if (result?.status === "okOverridden") {
      throw new Error("POLICY_REJECTED: A managed configuration overrides the personal boss_repl approval policy.");
    }
    if (result?.status !== "ok" || path.resolve(result.filePath) !== path.resolve(configPath)) {
      throw new Error("USER_CONFIG_ERROR: Codex App Server did not confirm the user config update.");
    }
    return { changed: result.version !== userLayer.version, configPath, version: result.version };
  } catch (error) {
    if (/^(?:POLICY_REJECTED|USER_CONFIG_ERROR):/u.test(error.message)) throw error;
    throw new Error(`USER_CONFIG_ERROR: Cannot persist the boss_repl tool approval: ${error.message}`, { cause: error });
  } finally {
    client.close();
  }
}

export { approvalKeyPath as bossReplApprovalKeyPath };
