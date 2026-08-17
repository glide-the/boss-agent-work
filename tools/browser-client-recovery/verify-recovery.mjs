#!/usr/bin/env bun

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolDirectory = import.meta.dirname;
const workspaceRoot = path.resolve(toolDirectory, "../..");
const baselinePath = path.join(workspaceRoot, "components/codex-plugin/scripts/browser-client.mjs");
const baselinePolicyPath = path.join(workspaceRoot, "components/codex-plugin/scripts/site-status-policy.mjs");
const candidatePath = path.join(workspaceRoot, "recovery/browser-client/dist/browser-client.mjs");
const candidatePolicyPath = path.join(
  workspaceRoot,
  "recovery/browser-client/dist/security/site-status-policy.mjs",
);
const fingerprintPath = path.join(
  workspaceRoot,
  "recovery/browser-client/analysis/bundle-fingerprint.json",
);
const fixtureManifestPath = path.join(
  workspaceRoot,
  "recovery/browser-client/fixtures/baseline-manifest.json",
);
const buildManifestPath = path.join(
  workspaceRoot,
  "recovery/browser-client/dist/build-manifest.json",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function importFresh(fileName) {
  const url = pathToFileURL(fileName);
  url.searchParams.set("recoveryVerification", `${Date.now()}-${Math.random()}`);
  return await import(url.href);
}

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

async function policySnapshot(policyModule) {
  const snapshots = {};
  let disabledCalls = 0;
  const disabled = new policyModule.SiteStatusPolicy({
    getEnvironment: () => ({}),
    getFetch: () => async () => { disabledCalls += 1; },
    logger: () => {},
  });
  await disabled.throwIfBlocksUrl("https://example.com/private", "chrome");
  snapshots.disabled = {
    calls: disabledCalls,
    configuration: policyModule.resolveSiteStatusConfiguration({}),
  };

  const requestUrls = [];
  const enabled = new policyModule.SiteStatusPolicy({
    getEnvironment: () => ({
      BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true",
      BROWSER_USE_SITE_STATUS_BASE_URL: "http://127.0.0.1:8787",
    }),
    getFetch: () => async (url) => {
      requestUrls.push(url);
      return response({ feature_status: { agent: true } });
    },
    getTurnMetadata: () => ({ session_id: "session", turn_id: "turn" }),
    logger: () => {},
  });
  await enabled.throwIfBlocksUrl("https://www.example.com/one?secret=1#fragment", "chrome");
  await enabled.throwIfBlocksUrl("https://example.com/two", "chrome");
  snapshots.allowedAndCached = { calls: requestUrls.length, requestUrl: requestUrls[0] };

  const logs = [];
  const failOpen = new policyModule.SiteStatusPolicy({
    getEnvironment: () => ({ BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true" }),
    getFetch: () => async () => { throw new Error("private transport detail"); },
    logger: (event) => logs.push(event),
  });
  await failOpen.throwIfBlocksUrl("https://example.org/path?secret=1", "iab");
  snapshots.failOpen = logs;

  let concurrentCalls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const concurrent = new policyModule.SiteStatusPolicy({
    getEnvironment: () => ({ BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true" }),
    getFetch: () => async () => {
      concurrentCalls += 1;
      await gate;
      return response({ feature_status: { agent: true } });
    },
    logger: () => {},
  });
  const first = concurrent.throwIfBlocksUrl("https://example.net/one", "cdp");
  const second = concurrent.throwIfBlocksUrl("https://example.net/two", "cdp");
  release();
  await Promise.all([first, second]);
  snapshots.concurrentMerge = { calls: concurrentCalls };

  const blocked = new policyModule.SiteStatusPolicy({
    getEnvironment: () => ({ BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true" }),
    getFetch: () => async () => response({ feature_status: { agent: false } }),
    logger: () => {},
  });
  try {
    await blocked.throwIfBlocksUrl("https://blocked.example/path", "chrome", {
      createBlockedError: (reason) => new TypeError(`blocked:${reason}`),
      displayName: "Chrome",
    });
  } catch (error) {
    snapshots.blocked = { name: error.name, message: error.message };
  }
  return snapshots;
}

async function main() {
  const [
    baselineSource,
    candidateSource,
    fingerprintSource,
    fixtureManifestSource,
    buildManifestSource,
  ] = await Promise.all([
    readFile(baselinePath),
    readFile(candidatePath, "utf8"),
    readFile(fingerprintPath, "utf8"),
    readFile(fixtureManifestPath, "utf8"),
    readFile(buildManifestPath, "utf8"),
  ]);
  const fingerprint = JSON.parse(fingerprintSource);
  const fixtureManifest = JSON.parse(fixtureManifestSource);
  const buildManifest = JSON.parse(buildManifestSource);
  assert.equal(sha256(baselineSource), fingerprint.sha256, "baseline hash drifted after AST capture");
  assert.equal(
    sha256(baselineSource),
    fixtureManifest.activeBaseline.sha256,
    "baseline hash drifted from the committed fixture manifest",
  );
  assert.equal(baselineSource.length, fixtureManifest.activeBaseline.bytes);
  assert.equal(buildManifest.packageManager.name, "bun");
  assert.equal(buildManifest.packageManager.version, Bun.version);
  assert.equal(buildManifest.bundler.name, "Bun.build");
  assert.equal(buildManifest.outputs.length, 2);
  assert.equal(
    candidateSource.includes('from "./runtime/compatibility-runtime'),
    false,
    "Browser Client output still contains an unbundled local runtime import",
  );
  const resolvedBaselinePath = fileURLToPath(new URL(
    "../../../components/codex-plugin/scripts/browser-client.mjs",
    pathToFileURL(candidatePath),
  ));
  assert.equal(resolvedBaselinePath, baselinePath, "bundled compatibility runtime resolves the wrong baseline");

  const [baseline, candidate, baselinePolicy, candidatePolicy] = await Promise.all([
    importFresh(baselinePath),
    importFresh(candidatePath),
    importFresh(baselinePolicyPath),
    importFresh(candidatePolicyPath),
  ]);
  assert.deepEqual(Object.keys(candidate).sort(), Object.keys(baseline).sort());
  assert.deepEqual(Object.keys(candidate).sort(), ["setupBrowserRuntime"]);
  assert.equal(typeof candidate.setupBrowserRuntime, "function");
  assert.deepEqual(Object.keys(candidatePolicy).sort(), Object.keys(baselinePolicy).sort());
  assert.deepEqual(await policySnapshot(candidatePolicy), await policySnapshot(baselinePolicy));

  const sourceText = baselineSource.toString("utf8");
  for (const anchor of [
    "ensureUrlOriginConsentAllowed",
    "ensureCurrentTabFileTransferAllowed",
    "ensureFullCdpAllowed",
    "__BossSiteStatusPolicy",
    'ki("https://chatgpt.com/backend-api/aura/identity")',
  ]) {
    assert.equal(sourceText.includes(anchor), true, `missing security compatibility anchor: ${anchor}`);
  }
  assert.equal(
    sourceText.includes('var s6="https://chatgpt.com/backend-api",a6="agent";'),
    false,
    "remote site_status fallback was reintroduced",
  );
  console.log(JSON.stringify({
    baselineSha256: fingerprint.sha256,
    browserClientExports: Object.keys(candidate).sort(),
    bundler: `Bun.build ${Bun.version}`,
    bundledOutputs: buildManifest.outputs.map((output) => output.path),
    siteStatusDifferential: "pass",
    securityAnchors: "pass",
  }, null, 2));
}

await main();
