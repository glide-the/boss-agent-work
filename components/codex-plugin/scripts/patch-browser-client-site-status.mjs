#!/usr/bin/env node

// scripts/patch-browser-client-site-status.ts
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
var IMPORT_LINE = 'import { SiteStatusPolicy as __BossSiteStatusPolicy } from "./site-status-policy.mjs";';
var PATCH_SENTINEL = "__BossSiteStatusPolicy";
var REMOTE_BASE = "https://chatgpt.com/backend-api";
var LOCAL_BASE = "http://127.0.0.1:8787";
var REMOTE_SITE_STATUS_ANCHOR = `var s6="${REMOTE_BASE}",a6="agent";`;
var LOCAL_SITE_STATUS_ANCHOR = `var s6="${LOCAL_BASE}",a6="agent";`;
var BLOCK_START = "var rP=async(t,e)=>";
var BLOCK_END = 'import{readFile as AH}from"node:fs/promises";';
var INTEGRATION = "var RH=new __BossSiteStatusPolicy({getEnvironment:()=>globalThis.nodeRepl?.env??{},getFetch:()=>Re()?.fetch,getTurnMetadata:ze});async function nP(t,e,r){let n=be(r);await RH.throwIfBlocksUrl(t,e,{displayName:n,createBlockedError:o=>new Error(ne(o))})}";
function hasIntegratedPolicy(source) {
  return source.includes(IMPORT_LINE) && source.includes("new __BossSiteStatusPolicy") && source.includes(".throwIfBlocksUrl(");
}
function patchBrowserClientSource(input) {
  if (hasIntegratedPolicy(input)) {
    if (input.includes(REMOTE_SITE_STATUS_ANCHOR)) {
      throw new Error("Patched browser client still contains the remote site_status base URL.");
    }
    return { changed: false, source: input };
  }
  if (input.includes(PATCH_SENTINEL)) {
    throw new Error("Browser client contains a partial or unknown site_status patch.");
  }
  if (!input.includes(REMOTE_SITE_STATUS_ANCHOR)) {
    throw new Error("Browser client remote site_status base anchor was not found.");
  }
  const start = input.indexOf(BLOCK_START);
  const end = input.indexOf(BLOCK_END, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Browser client site_status implementation anchors were not found.");
  }
  let source = `${IMPORT_LINE}
${input}`;
  source = source.replace(REMOTE_SITE_STATUS_ANCHOR, LOCAL_SITE_STATUS_ANCHOR);
  const adjustedStart = source.indexOf(BLOCK_START);
  const adjustedEnd = source.indexOf(BLOCK_END, adjustedStart);
  source = `${source.slice(0, adjustedStart)}${INTEGRATION}${source.slice(adjustedEnd)}`;
  if (source.includes(REMOTE_SITE_STATUS_ANCHOR)) {
    throw new Error("Browser client patch did not remove the remote site_status base URL.");
  }
  return { changed: true, source };
}
function verifyPatchedBrowserClientSource(source) {
  const failures = [];
  if (!source.includes(IMPORT_LINE))
    failures.push("site-status-policy import is missing");
  if (!hasIntegratedPolicy(source))
    failures.push("site status policy integration is missing");
  if (source.includes(REMOTE_SITE_STATUS_ANCHOR))
    failures.push("remote ChatGPT site_status base URL remains");
  if (!source.includes("ensureUrlOriginConsentAllowed"))
    failures.push("origin consent logic is missing");
  if (!source.includes("ensureCurrentTabFileTransferAllowed"))
    failures.push("file transfer authorization logic is missing");
  if (!source.includes('"disabled-for-local-testing"'))
    failures.push("existing security mode compatibility is missing");
  return failures;
}
async function main(arguments_) {
  const checkOnly = arguments_.includes("--check");
  const positional = arguments_.filter((argument) => argument !== "--check");
  if (positional.length !== 1) {
    throw new Error("Usage: patch-browser-client-site-status.mjs [--check] <browser-client.mjs>");
  }
  const filePath = path.resolve(positional[0]);
  const input = await fs.readFile(filePath, "utf8");
  if (checkOnly) {
    const failures = verifyPatchedBrowserClientSource(input);
    if (failures.length > 0) {
      throw new Error(`Browser client site_status verification failed: ${failures.join(", ")}`);
    }
    return;
  }
  const result = patchBrowserClientSource(input);
  if (!result.changed)
    return;
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, result.source, "utf8");
  await fs.rename(temporaryPath, filePath);
}
var invokedPath = process.argv[1];
if (invokedPath != null && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
export {
  verifyPatchedBrowserClientSource,
  patchBrowserClientSource
};
