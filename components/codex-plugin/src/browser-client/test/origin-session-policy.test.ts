import { describe, expect, test } from "bun:test";

import {
  createOriginSessionPolicy,
  type ConfigStore,
  type ElicitationRequest,
  type NodeReplState,
  type PrivilegedNodeRepl,
} from "../security/origin-session-policy.ts";

const GLOBAL_CONFIG_PATH = "browser/config.toml";
const SESSION_CONFIG_PATH = "browser/sessions/session-1.toml";

interface FixtureOptions {
  config?: unknown;
  requirements?: unknown;
  requestMeta?: Record<string, unknown>;
  toml?: Record<string, Record<string, unknown>>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createFixture(options: FixtureOptions = {}) {
  const files = new Map<string, Record<string, unknown>>(
    Object.entries(options.toml ?? {}).map(([path, value]) => [
      path,
      clone(value),
    ]),
  );
  const writes: Array<{ path: string; contents: Record<string, unknown> }> = [];
  const elicitationCalls: ElicitationRequest[] = [];
  let failConfigRead = false;
  let failTomlRead = false;
  let failTomlWrite = false;
  const configStore: ConfigStore = {
    async readRequirements(): Promise<unknown> {
      if (failConfigRead) throw new Error("requirements unavailable");
      return clone(
        Object.hasOwn(options, "requirements") ? options.requirements : {},
      );
    },
    async read(): Promise<unknown> {
      if (failConfigRead) throw new Error("config unavailable");
      return clone(Object.hasOwn(options, "config") ? options.config : {});
    },
    async readToml(path: string): Promise<unknown> {
      if (failTomlRead) throw new Error("TOML unavailable");
      return clone(files.get(path) ?? {});
    },
    async writeToml(
      path: string,
      contents: Record<string, unknown>,
    ): Promise<void> {
      if (failTomlWrite) throw new Error("TOML read-only");
      const saved = clone(contents);
      files.set(path, saved);
      writes.push({ path, contents: saved });
    },
  };
  const client: PrivilegedNodeRepl = { config: configStore, cwd: "/workspace" };
  const nodeRepl: NodeReplState = {
    config: configStore,
    cwd: "/fallback-workspace",
    requestMeta: options.requestMeta ?? {
      "x-codex-turn-metadata": {
        session_id: "session-1",
        turn_id: "turn-1",
      },
    },
  };
  const policy = createOriginSessionPolicy({
    formatSecurityError: (message) => `secured:${message}`,
    getDefaultPrivilegedNodeRepl: () => client,
    getElicitationProvider: () => async (request) => {
      elicitationCalls.push(request);
      return { action: "accept" };
    },
    getNodeRepl: () => nodeRepl,
    globalConfigPath: GLOBAL_CONFIG_PATH,
  });
  return {
    elicitationCalls,
    files,
    policy,
    setFailConfigRead(value: boolean) {
      failConfigRead = value;
    },
    setFailTomlRead(value: boolean) {
      failTomlRead = value;
    },
    setFailTomlWrite(value: boolean) {
      failTomlWrite = value;
    },
    writes,
  };
}

describe("origin/session policy semantic reconstruction", () => {
  test("extracts turn metadata and uses subagent thread identity", () => {
    const { policy } = createFixture({
      requestMeta: {
        "x-codex-turn-metadata": {
          session_id: "parent-session",
          thread_id: "subagent-thread",
          thread_source: "subagent",
          turn_id: "turn-7",
        },
      },
    });

    expect(policy.getCodexSessionId()).toBe("subagent-thread");
    expect(policy.missingRequiredTurnMetadata()).toEqual([]);
    expect(() => policy.assertRequiredTurnMetadata()).not.toThrow();
  });

  test("persisted denials take priority over allows at every scope", async () => {
    const origin = "https://example.com";
    const conversationDenied = createFixture({
      toml: {
        [GLOBAL_CONFIG_PATH]: { full_cdp: { allowed: [origin] } },
        [SESSION_CONFIG_PATH]: { full_cdp: { denied: [origin] } },
      },
    });
    await expect(
      conversationDenied.policy.queryFullCdp(origin),
    ).resolves.toEqual({
      decision: "deny",
      scope: "conversation",
      source: "browser-use-persisted-state",
    });

    const globallyDenied = createFixture({
      toml: {
        [GLOBAL_CONFIG_PATH]: { full_cdp: { denied: [origin] } },
        [SESSION_CONFIG_PATH]: { full_cdp: { allowed: [origin] } },
      },
    });
    await expect(globallyDenied.policy.queryFullCdp(origin)).resolves.toEqual({
      decision: "deny",
      scope: "global",
      source: "browser-use-persisted-state",
    });
  });

  test("managed network policy denies allowlist misses and cannot be relaxed locally", async () => {
    const { elicitationCalls, policy } = createFixture({
      requirements: {
        requirements: {
          network: {
            allowed_domains: ["**.approved.test"],
            managed_allowed_domains_only: true,
          },
        },
      },
      config: {
        default_permissions: "developer",
        permissions: {
          developer: {
            network: { allowed_domains: ["blocked.test"] },
          },
        },
      },
    });

    await expect(policy.queryOrigin("https://blocked.test")).resolves.toEqual({
      decision: "deny",
      scope: "global",
      source: "codex-network-policy",
    });
    await expect(
      policy.requestOriginConsent("https://blocked.test"),
    ).rejects.toThrow(
      "secured:Browser use cannot access https://blocked.test because enterprise network policy blocks it.",
    );
    expect(elicitationCalls).toEqual([]);
    await expect(
      policy.queryOrigin("https://sub.approved.test"),
    ).resolves.toEqual({
      decision: "approve",
      scope: "global",
      source: "browser-use-runtime-policy",
    });
  });

  test("disabled origin authorization bypasses consent state without weakening independent grants", async () => {
    const origin = "https://example.com";
    const { elicitationCalls, files, policy, writes } = createFixture({
      toml: {
        [GLOBAL_CONFIG_PATH]: {
          full_cdp: { denied: [origin] },
          origins: { denied: [origin] },
        },
      },
    });

    await expect(policy.queryOrigin(origin)).resolves.toEqual({
      decision: "approve",
      scope: "global",
      source: "browser-use-runtime-policy",
    });
    await expect(policy.requestOriginConsent(origin)).resolves.toBeUndefined();
    expect(elicitationCalls).toEqual([]);
    await expect(policy.queryFullCdp(origin)).resolves.toEqual({
      decision: "deny",
      scope: "global",
      source: "browser-use-persisted-state",
    });
    await policy.persistOriginResponse(origin, {
      action: "decline",
      meta: { persist: "always" },
    });
    expect(writes).toEqual([]);
    expect(files.get(GLOBAL_CONFIG_PATH)).toEqual({
      full_cdp: { denied: [origin] },
      origins: { denied: [origin] },
    });
  });

  test("accept and decline replace the opposite session decision", async () => {
    const origin = "https://example.com";
    const { files, policy, writes } = createFixture({
      toml: {
        [SESSION_CONFIG_PATH]: { full_cdp: { denied: [origin] } },
      },
    });

    await policy.persistFullCdpResponse(origin, { action: "accept" });
    expect(files.get(SESSION_CONFIG_PATH)).toEqual({
      full_cdp: { allowed: [origin], denied: [] },
    });

    await policy.persistFullCdpResponse(origin, { action: "decline" });
    expect(files.get(SESSION_CONFIG_PATH)).toEqual({
      full_cdp: { allowed: [], denied: [origin] },
    });
    expect(writes.map(({ path }) => path)).toEqual([
      SESSION_CONFIG_PATH,
      SESSION_CONFIG_PATH,
    ]);
  });

  test("honors explicit session and global persistence scopes", async () => {
    const sessionOrigin = "https://session.test";
    const globalOrigin = "https://global.test";
    const { files, policy } = createFixture();

    await policy.persistFileTransferResponse("download", sessionOrigin, {
      action: "accept",
      meta: { persist: "session" },
    });
    await policy.persistFileTransferResponse("upload", globalOrigin, {
      action: "decline",
      _meta: { persist: "always" },
    });

    expect(files.get(SESSION_CONFIG_PATH)).toEqual({
      downloads: { allowed: [sessionOrigin] },
    });
    expect(files.get(GLOBAL_CONFIG_PATH)).toEqual({
      uploads: { denied: [globalOrigin] },
    });
  });

  test("persists only globally accepted history consent", async () => {
    const accepted = createFixture({
      toml: { [GLOBAL_CONFIG_PATH]: { approval_mode: "always_ask" } },
    });
    await accepted.policy.persistHistoryResponse({
      action: "accept",
      content: { persist: "always" },
    });
    expect(accepted.files.get(GLOBAL_CONFIG_PATH)).toEqual({
      approval_mode: "always_ask",
      history_approval_mode: "never_ask",
    });

    const declined = createFixture();
    await declined.policy.persistHistoryResponse({
      action: "decline",
      meta: { persist: "always" },
    });
    expect(declined.writes).toEqual([]);
  });

  test("fails closed for network reads but treats TOML and write failures as best effort", async () => {
    const networkFailure = createFixture();
    networkFailure.setFailConfigRead(true);
    await expect(
      networkFailure.policy.queryOrigin("https://example.com"),
    ).resolves.toEqual({
      decision: "deny",
      scope: "global",
      source: "codex-network-policy",
    });

    const tomlFailure = createFixture();
    tomlFailure.setFailTomlRead(true);
    await expect(
      tomlFailure.policy.queryFileTransfer("download", "https://example.com"),
    ).resolves.toBeNull();

    const writeFailure = createFixture();
    writeFailure.setFailTomlWrite(true);
    await expect(
      writeFailure.policy.persistFullCdpResponse("https://example.com", {
        action: "decline",
      }),
    ).resolves.toBeUndefined();
    expect(writeFailure.writes).toEqual([]);
  });

  test("fails closed when network policy readers return invalid top-level values", async () => {
    for (const invalidLayer of [null, undefined, "invalid"]) {
      const invalidRequirements = createFixture({
        requirements: invalidLayer,
      });
      await expect(
        invalidRequirements.policy.queryOrigin("https://example.com"),
      ).resolves.toEqual({
        decision: "deny",
        scope: "global",
        source: "codex-network-policy",
      });

      const invalidConfig = createFixture({
        config: invalidLayer,
      });
      await expect(
        invalidConfig.policy.queryOrigin("https://example.com"),
      ).resolves.toEqual({
        decision: "deny",
        scope: "global",
        source: "codex-network-policy",
      });
    }
  });

  test("fails closed when no privileged client can evaluate managed network policy", async () => {
    const fixture = createFixture();
    const policy = createOriginSessionPolicy({
      formatSecurityError: (message) => message,
      getDefaultPrivilegedNodeRepl: () => undefined,
      getElicitationProvider: () => undefined,
      getNodeRepl: () => ({ requestMeta: {} }),
      globalConfigPath: GLOBAL_CONFIG_PATH,
    });

    await expect(policy.queryOrigin("https://example.com")).resolves.toEqual({
      decision: "deny",
      scope: "global",
      source: "codex-network-policy",
    });
    expect(fixture.writes).toEqual([]);
  });
});
