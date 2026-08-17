#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const IMPORT_LINE = 'import { SiteStatusPolicy as __BossSiteStatusPolicy } from "./site-status-policy.mjs";';
const PATCH_SENTINEL = "__BossSiteStatusPolicy";
const REMOTE_BASE = "https://chatgpt.com/backend-api";
const LOCAL_BASE = "http://127.0.0.1:8787";
const REMOTE_SITE_STATUS_ANCHOR = `var s6="${REMOTE_BASE}",a6="agent";`;
const LOCAL_SITE_STATUS_ANCHOR = `var s6="${LOCAL_BASE}",a6="agent";`;
const BLOCK_START = "var rP=async(t,e)=>";
const BLOCK_END = 'import{readFile as AH}from"node:fs/promises";';
const INTEGRATION = `var RH=new __BossSiteStatusPolicy({getEnvironment:()=>globalThis.nodeRepl?.env??{},getFetch:()=>Re()?.fetch,getTurnMetadata:ze});async function nP(t,e,r){let n=be(r);await RH.throwIfBlocksUrl(t,e,{displayName:n,createBlockedError:o=>new Error(ne(o))})}`;

export function patchBrowserClientSource(input) {
  if (input.includes(IMPORT_LINE) && input.includes(INTEGRATION)) {
    if (input.includes(REMOTE_SITE_STATUS_ANCHOR)) throw new Error("Patched browser client still contains the remote site_status base URL.");
    return { changed: false, source: input };
  }
  if (input.includes(PATCH_SENTINEL)) throw new Error("Browser client contains a partial or unknown site_status patch.");
  if (!input.includes(REMOTE_SITE_STATUS_ANCHOR)) {
    throw new Error("Browser client remote site_status base anchor was not found.");
  }
  const start = input.indexOf(BLOCK_START);
  const end = input.indexOf(BLOCK_END, start);
  if (start < 0 || end < 0 || end <= start) throw new Error("Browser client site_status implementation anchors were not found.");

  let source = `${IMPORT_LINE}\n${input}`;
  source = source.replace(REMOTE_SITE_STATUS_ANCHOR, LOCAL_SITE_STATUS_ANCHOR);
  const adjustedStart = source.indexOf(BLOCK_START);
  const adjustedEnd = source.indexOf(BLOCK_END, adjustedStart);
  source = `${source.slice(0, adjustedStart)}${INTEGRATION}${source.slice(adjustedEnd)}`;
  if (source.includes(REMOTE_SITE_STATUS_ANCHOR)) throw new Error("Browser client patch did not remove the remote site_status base URL.");
  return { changed: true, source };
}

export function verifyPatchedBrowserClientSource(source) {
  const failures = [];
  if (!source.includes(IMPORT_LINE)) failures.push("site-status-policy import is missing");
  if (!source.includes(INTEGRATION)) failures.push("site status policy integration is missing");
  if (source.includes(REMOTE_SITE_STATUS_ANCHOR)) failures.push("remote ChatGPT site_status base URL remains");
  if (!source.includes(LOCAL_SITE_STATUS_ANCHOR)) failures.push("local site_status compatibility anchor is missing");
  if (!source.includes("ensureUrlOriginConsentAllowed")) failures.push("origin consent logic is missing");
  if (!source.includes("ensureCurrentTabFileTransferAllowed")) failures.push("file transfer authorization logic is missing");
  if (!source.includes('"disabled-for-local-testing"')) failures.push("existing security mode compatibility is missing");
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
    if (failures.length > 0) throw new Error(`Browser client site_status verification failed: ${failures.join(", ")}`);
    return;
  }
  const result = patchBrowserClientSource(input);
  if (!result.changed) return;
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, result.source, "utf8");
  await fs.rename(temporaryPath, filePath);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
