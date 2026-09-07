import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  bossBrowserServiceName,
  createBossBrowserRpc,
  createPersonalBrowserLaunchPlan,
  legacyBrowserClientTrustVariable,
} from "../runtime/trusted-service.ts";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("personal trusted browser service", () => {
  test("routes only through the personal service namespace", async () => {
    const calls: unknown[] = [];
    const rpc = createBossBrowserRpc({
      nodeRepl: {
        async rpc(service: string, request: unknown) {
          calls.push({ service, request });
          return { ok: true };
        },
      },
    });
    expect(await rpc("setup", { environment: "codex-app" })).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        service: bossBrowserServiceName,
        request: { method: "setup", params: { environment: "codex-app" } },
      },
    ]);
  });

  test("builds an isolated launch environment without inheriting the legacy hash or official services", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "boss-service-plan-"));
    cleanup.push(root);
    const pluginRoot = path.join(root, "plugin");
    const resourcesRoot = path.join(root, "Resources");
    const executable = path.join(resourcesRoot, "cua_node/bin/node_repl");
    const nodePath = path.join(resourcesRoot, "cua_node/bin/node");
    for (const filePath of [
      executable,
      nodePath,
      path.join(pluginRoot, "scripts/browser-client.mjs"),
      path.join(pluginRoot, "scripts/browser-service.mjs"),
    ]) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, "fixture");
    }
    const plan = await createPersonalBrowserLaunchPlan({
      pluginRoot,
      environment: {
        HOME: root,
        BOSS_PLUGIN_NODE_REPL_PATH: executable,
        [legacyBrowserClientTrustVariable]: "0".repeat(64),
        NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser: "/official/service.mjs" }),
      },
    });
    expect(plan.executable).toBe(executable);
    expect(plan.environment[legacyBrowserClientTrustVariable]).toBeUndefined();
    expect(JSON.parse(plan.environment.NODE_REPL_TRUSTED_SERVICES ?? "{}")).toEqual({
      [bossBrowserServiceName]: path.join(pluginRoot, "scripts/browser-service.mjs"),
    });
    expect(plan.environment.BROWSER_USE_AVAILABLE_BACKENDS).toBe("chrome");
    expect(plan.environment.NODE_REPL_JS_BANNER).toContain("browser-client.mjs");
  });

  test("rejects a generic runtime that does not expose service RPC", () => {
    expect(() => createBossBrowserRpc({ nodeRepl: {} })).toThrow(
      "BOSS_BROWSER_SERVICE_UNAVAILABLE",
    );
  });
});
