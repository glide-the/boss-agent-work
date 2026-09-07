import { setupBrowserServiceRuntime } from "./browser-runtime.generated.js";

interface BrowserServiceRuntime {
  apiManifest: unknown;
  disabledMemberIds: string[];
  dispose(): Promise<void>;
  executeAgentCommand(command: unknown): Promise<unknown>;
}

interface ServiceRequest {
  method?: unknown;
  params?: unknown;
}

function ping(params: unknown): unknown {
  const nonce =
    typeof params === "object" && params !== null && "nonce" in params
      ? String(params.nonce)
      : "";
  return {
    nativePipeAvailable:
      typeof (
        globalThis as typeof globalThis & {
          nodeRepl?: { nativePipe?: { createConnection?: unknown } };
        }
      ).nodeRepl?.nativePipe?.createConnection === "function",
    nonce,
    protocolVersion: 1,
    service: "boss_browser",
  };
}

let runtime: BrowserServiceRuntime | null = null;

async function setup(params: unknown): Promise<unknown> {
  if (params !== undefined && (typeof params !== "object" || params === null)) {
    throw new Error("Invalid boss_browser setup parameters");
  }
  if (runtime !== null) await runtime.dispose();
  runtime = await setupBrowserServiceRuntime({
    elicitationDisplayName: "Boss投递",
    globals: globalThis,
  });
  return {
    apiManifest: runtime.apiManifest,
    disabledMemberIds: runtime.disabledMemberIds,
  };
}

async function execute(params: unknown): Promise<unknown> {
  if (runtime === null) {
    throw new Error("Boss投递 browser service has not been initialized");
  }
  return await runtime.executeAgentCommand(params);
}

export async function handleRpc(request: ServiceRequest): Promise<unknown> {
  if (request === null || typeof request !== "object") {
    throw new Error("Invalid boss_browser service request");
  }
  if (request.method === "ping") return ping(request.params);
  if (request.method === "setup") return await setup(request.params);
  if (request.method === "execute") return await execute(request.params);
  throw new Error(`Unsupported boss_browser service request: ${String(request.method)}`);
}
