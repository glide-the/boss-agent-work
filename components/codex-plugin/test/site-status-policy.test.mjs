import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  SiteStatusConfigurationError,
  SiteStatusPolicy,
  buildSiteStatusRequest,
  resolveSiteStatusConfiguration,
} from "../scripts/site-status-policy.mjs";
import { verifyPatchedBrowserClientSource } from "../scripts/patch-browser-client-site-status.mjs";

const TARGET_URL = "https://item.taobao.com/item.htm?id=secret-token#private";

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

function createPolicy({ environment = {}, fetcher, logger = () => {}, timeoutMs = 50 } = {}) {
  return new SiteStatusPolicy({
    getEnvironment: () => environment,
    getFetch: () => fetcher,
    getTurnMetadata: () => ({ session_id: "conversation-secret", turn_id: "turn-secret" }),
    logger,
    timeoutMs,
  });
}

test("default configuration skips site_status without calling fetch", async () => {
  let calls = 0;
  const policy = createPolicy({ fetcher: async () => { calls += 1; } });
  await policy.throwIfBlocksUrl(TARGET_URL, "chrome");
  assert.equal(calls, 0);
  assert.deepEqual(resolveSiteStatusConfiguration({}), { enabled: false, baseUrl: null });
});

test("enabled=false skips site_status without validating or calling the configured service", async () => {
  let calls = 0;
  const policy = createPolicy({
    environment: {
      BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "false",
      BROWSER_USE_SITE_STATUS_BASE_URL: "https://chatgpt.com/backend-api",
    },
    fetcher: async () => { calls += 1; },
  });
  await policy.throwIfBlocksUrl(TARGET_URL, "chrome");
  assert.equal(calls, 0);
});

test("enabled local service with agent=true allows and preserves request parameters", async () => {
  let requestUrl;
  const policy = createPolicy({
    environment: {
      BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true",
      BROWSER_USE_SITE_STATUS_BASE_URL: "http://127.0.0.1:8787",
    },
    fetcher: async (url) => {
      requestUrl = new URL(url);
      return response({ feature_status: { agent: true } });
    },
  });
  await policy.throwIfBlocksUrl(TARGET_URL, "chrome");
  assert.equal(requestUrl.origin, "http://127.0.0.1:8787");
  assert.equal(requestUrl.pathname, "/aura/site_status");
  assert.equal(requestUrl.searchParams.get("site_url"), "https://item.taobao.com/item.htm?id=secret-token");
  assert.equal(requestUrl.searchParams.get("url_request_source"), "codex_browser_use:chrome");
  assert.equal(requestUrl.searchParams.get("conversation_id"), "conversation-secret");
  assert.equal(requestUrl.searchParams.get("turn_id"), "turn-secret");
  assert.equal(requestUrl.toString().includes("chatgpt.com"), false);
});

test("enabled local service with agent=false keeps the caller-provided blocked error", async () => {
  const policy = createPolicy({
    environment: { BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true" },
    fetcher: async () => response({ feature_status: { agent: false }, reason: "local-policy" }),
  });
  await assert.rejects(
    policy.throwIfBlocksUrl(TARGET_URL, "chrome", {
      displayName: "Chrome",
      createBlockedError: (reason) => new Error(`Browser Use rejected this action. ${reason}`),
    }),
    /Browser Use rejected this action\. Chrome is not permitted on https:\/\/item\.taobao\.com\/item\.htm\./,
  );
});

for (const [name, fetcher, failureType] of [
  ["connection failure", async () => { throw new Error("ECONNREFUSED private-value"); }, "network_error"],
  ["HTTP 5xx", async () => response({}, { ok: false, status: 503 }), "http_error"],
  ["invalid JSON", async () => ({ ok: true, status: 200, async json() { throw new Error("raw-body-secret"); } }), "invalid_json"],
  ["missing protocol field", async () => response({ feature_status: {} }), "invalid_response"],
]) {
  test(`${name} fails open with a redacted diagnostic`, async () => {
    const logs = [];
    const policy = createPolicy({
      environment: { BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true" },
      fetcher,
      logger: (event) => logs.push(event),
    });
    await policy.throwIfBlocksUrl(TARGET_URL, "chrome");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].failureType, failureType);
    assert.equal(logs[0].targetOrigin, "https://item.taobao.com");
    assert.equal(logs[0].targetPathname, "/item.htm");
    const serialized = JSON.stringify(logs[0]);
    assert.equal(serialized.includes("secret-token"), false);
    assert.equal(serialized.includes("conversation-secret"), false);
    assert.equal(serialized.includes("turn-secret"), false);
    assert.equal(serialized.includes("raw-body-secret"), false);
  });
}

test("timeout fails open", async () => {
  const logs = [];
  const policy = createPolicy({
    environment: { BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true" },
    fetcher: async () => await new Promise(() => {}),
    logger: (event) => logs.push(event),
    timeoutMs: 5,
  });
  await policy.throwIfBlocksUrl(TARGET_URL, "chrome");
  assert.equal(logs[0]?.failureType, "timeout");
});

test("enabled non-loopback service is rejected before fetch", async () => {
  let calls = 0;
  const policy = createPolicy({
    environment: {
      BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true",
      BROWSER_USE_SITE_STATUS_BASE_URL: "https://chatgpt.com/backend-api",
    },
    fetcher: async () => { calls += 1; },
  });
  await assert.rejects(
    policy.throwIfBlocksUrl(TARGET_URL, "chrome"),
    SiteStatusConfigurationError,
  );
  assert.equal(calls, 0);
});

test("enabled flag rejects ambiguous boolean values", () => {
  assert.throws(
    () => resolveSiteStatusConfiguration({ BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "1" }),
    SiteStatusConfigurationError,
  );
});

test("all documented loopback host forms are accepted", () => {
  for (const baseUrl of [
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "http://[::1]:8787",
  ]) {
    const configuration = resolveSiteStatusConfiguration({
      BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "TRUE",
      BROWSER_USE_SITE_STATUS_BASE_URL: baseUrl,
    });
    assert.equal(configuration.enabled, true);
    assert.equal(new URL(configuration.baseUrl).hostname, new URL(baseUrl).hostname);
  }
});

test("runtime failures are not cached", async () => {
  let calls = 0;
  const policy = createPolicy({
    environment: { BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true" },
    fetcher: async () => {
      calls += 1;
      throw new Error("connection refused");
    },
  });
  await policy.throwIfBlocksUrl("https://example.com/one", "chrome");
  await policy.throwIfBlocksUrl("https://example.com/two", "chrome");
  assert.equal(calls, 2);
});

test("successful decisions are cached by normalized host", async () => {
  let calls = 0;
  const policy = createPolicy({
    environment: { BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true" },
    fetcher: async () => {
      calls += 1;
      return response({ feature_status: { agent: true } });
    },
  });
  await policy.throwIfBlocksUrl("https://www.example.com/one", "chrome");
  await policy.throwIfBlocksUrl("https://example.com/two", "chrome");
  assert.equal(calls, 1);
});

test("request builder skips local target URLs", () => {
  assert.equal(buildSiteStatusRequest("http://localhost:3000/path", {
    baseUrl: "http://127.0.0.1:8787",
  }), null);
});

test("patched browser client removes remote fallback and retains independent security checks", async () => {
  const browserClientPath = path.resolve(import.meta.dirname, "../scripts/browser-client.mjs");
  const source = await readFile(browserClientPath, "utf8");
  assert.deepEqual(verifyPatchedBrowserClientSource(source), []);
  assert.equal(source.includes('var s6="https://chatgpt.com/backend-api",a6="agent";'), false);
  assert.equal(source.includes('from "./site-status-policy.mjs"'), true);
  assert.equal(source.includes("new __BossSiteStatusPolicy"), true);
  assert.equal(source.includes(".throwIfBlocksUrl("), true);
  assert.equal(source.includes('ki("https://chatgpt.com/backend-api/aura/identity")'), true);
  assert.equal(source.includes("ensureUrlOriginConsentAllowed"), true);
  assert.equal(source.includes("ensureCurrentTabFileTransferAllowed"), true);
});
