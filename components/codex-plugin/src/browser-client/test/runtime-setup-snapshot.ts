interface BrowserRuntimeModule {
  setupBrowserRuntime(options: {
    elicitationDisplayName: string;
    globals: Record<string, unknown>;
  }): Promise<void>;
}

interface BrowserServiceModule {
  handleRpc(request: unknown): Promise<unknown>;
}

const runtimePath = process.argv[2];
if (runtimePath == null) throw new Error("Runtime path is required.");
const servicePath = process.argv[3];

const hooks: unknown[] = [];
const responseMeta: unknown[] = [];
let rpcCalls = 0;
const rpcServices: string[] = [];
const nodeRepl: Record<string, unknown> & {
  rpc?: (service: string, request: unknown) => Promise<unknown>;
} = {
  env: {},
  config: {
    async readToml(): Promise<Record<string, never>> {
      return {};
    },
    async writeToml(): Promise<void> {},
  },
  fetch: async (): Promise<Response> =>
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  nativePipe: {
    async createConnection(): Promise<never> {
      throw new Error("fixture connection should stay lazy");
    },
  },
  addAfterSubmittedCodeHook(hook: unknown): void {
    hooks.push(hook);
  },
  setResponseMeta(value: unknown): void {
    responseMeta.push(value);
  },
  async emitImage(): Promise<void> {},
};

Object.assign(globalThis, { nodeRepl });
if (servicePath != null) {
  const service = (await import(servicePath)) as BrowserServiceModule;
  nodeRepl.rpc = async (serviceName, request) => {
    rpcCalls += 1;
    rpcServices.push(serviceName);
    return await service.handleRpc(request);
  };
}
const runtime = (await import(runtimePath)) as BrowserRuntimeModule;
const logged: unknown[] = [];
const globals: Record<string, unknown> = {
  nodeRepl,
  console: {
    log(value: unknown): void {
      logged.push(value);
    },
  },
};

try {
  await runtime.setupBrowserRuntime({
    elicitationDisplayName: "Chrome",
    globals,
  });
  const agent = globals.agent;
  console.log(
    JSON.stringify({
      ok: true,
      exports: Object.keys(runtime).sort(),
      globalKeys: Object.keys(globals).sort(),
      agentKeys:
        typeof agent === "object" && agent !== null
          ? Reflect.ownKeys(agent).map(String).sort()
          : [],
      displayType: typeof globals.display,
      hooks: hooks.length,
      responseMeta,
      logged,
      rpcCalls,
      rpcServices,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      rpcCalls,
      rpcServices,
    }),
  );
}

process.exit(0);

export {};
