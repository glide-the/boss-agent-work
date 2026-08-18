#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { format } from "prettier";

const reconstructionRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(reconstructionRoot, "../../..");
const inputPath = path.join(
  workspaceRoot,
  "components/codex-plugin/scripts-bak/browser-client.mjs",
);
const outputPath = path.join(
  workspaceRoot,
  "components/codex-plugin/src/browser-client/browser-runtime.generated.js",
);
const evidenceMapPath = path.join(
  reconstructionRoot,
  "maps/materialized-runtime-map.json",
);
const expectedInputHash =
  "cf71c5bf138839ff6f6df07328a63d6897458f122ed68ee0bf496e301cc06c45";
const force = process.argv.slice(2).includes("--force");
const unexpectedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--force");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function assertWritableTargetPolicy() {
  try {
    await access(outputPath);
    if (!force) {
      throw new Error(
        `Refusing to overwrite ${path.relative(workspaceRoot, outputPath)} without --force.`,
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function replaceProcessShim(source) {
  const startAnchor = "const listeners = new Map();";
  const endAnchor = "globalThis.global = globalThis.global ?? globalThis;";
  const start = source.indexOf(startAnchor);
  const endStart = source.indexOf(endAnchor, start);
  if (start < 0 || endStart < 0) {
    throw new Error("Process shim anchors were not found in the verified input.");
  }
  const end = endStart + endAnchor.length;
  const replacement = [
    'import { installProcessShim as __installProcessShim, processShim as process } from "./runtime/process-shim.ts";',
    'import { createBrowserSecurityClass as __createBrowserSecurityClass } from "./security/browser-security.ts";',
    'import { createDisplay as DP, createNodeReplDisplayBridge as NG } from "./runtime/node-repl-display.ts";',
    "__installProcessShim();",
  ].join("\n");
  return {
    source: `${source.slice(0, start)}${replacement}${source.slice(end)}`,
    mapping: { inputStart: start, inputEnd: end, classification: "reconstructed" },
  };
}

function replaceFormattedNodeReplDisplay(source, rawInput) {
  const displayStartAnchor = "var eG = (t) => {";
  const documentationAnchor =
    'import { access as oG, readFile as iG } from "node:fs/promises";';
  const bridgeStartAnchor = "var NG = (t) => ({";
  const exportAnchor = "export { ATe as setupBrowserRuntime };";
  const displayStart = source.indexOf(displayStartAnchor);
  const documentationStart = source.indexOf(documentationAnchor, displayStart);
  if (displayStart < 0 || documentationStart < 0) {
    throw new Error("Formatted display serialization anchors were not found.");
  }
  const withoutDisplay = `${source.slice(0, displayStart)}${source.slice(documentationStart)}`;
  const bridgeStart = withoutDisplay.indexOf(bridgeStartAnchor);
  const exportStart = withoutDisplay.indexOf(exportAnchor, bridgeStart);
  if (bridgeStart < 0 || exportStart < 0) {
    throw new Error("Formatted node_repl display bridge anchors were not found.");
  }
  const transformed = `${withoutDisplay.slice(0, bridgeStart)}${withoutDisplay.slice(exportStart)}`;

  const rawDisplayStart = rawInput.indexOf("var eG=t=>{");
  const rawDocumentationStart = rawInput.indexOf(
    'import{access as oG,readFile as iG}from"node:fs/promises"',
    rawDisplayStart,
  );
  const rawBridgeStart = rawInput.indexOf("var NG=t=>({");
  const rawExportStart = rawInput.indexOf(
    "export{ATe as setupBrowserRuntime}",
    rawBridgeStart,
  );
  if (
    rawDisplayStart < 0 ||
    rawDocumentationStart < 0 ||
    rawBridgeStart < 0 ||
    rawExportStart < 0
  ) {
    throw new Error("Raw node_repl display bridge anchors were not found.");
  }
  return {
    source: transformed,
    mapping: {
      inputRanges: [
        { start: rawDisplayStart, end: rawDocumentationStart },
        { start: rawBridgeStart, end: rawExportStart },
      ],
      classification: "reconstructed",
    },
  };
}

function replaceFormattedBrowserSecurity(source, rawInput) {
  const classStartAnchor = 'var FH = new Set(["navigate_tab_url"]),';
  const elicitationAnchor = "function ts() {";
  const helperStartAnchor = "function jH(t) {";
  const nextModuleAnchor = 'import { randomUUID as YH } from "node:crypto";';
  const classStart = source.indexOf(classStartAnchor);
  const elicitationStart = source.indexOf(elicitationAnchor, classStart);
  const helperStart = source.indexOf(helperStartAnchor, elicitationStart);
  const nextModuleStart = source.indexOf(nextModuleAnchor, helperStart);
  if (
    classStart < 0 ||
    elicitationStart < 0 ||
    helperStart < 0 ||
    nextModuleStart < 0
  ) {
    throw new Error("Formatted Browser Security anchors were not found.");
  }

  const adapter = [
    "var np = __createBrowserSecurityClass({",
    "  checkDegradedHost: oP,",
    "  checkSiteStatus: nP,",
    "  extractOrigin: Oe,",
    "  formatBrowserName: be,",
    "  formatSecurityError: ne,",
    "  isNavigationUrlAllowed: mE,",
    "  isOperationWithoutUserConsent: er,",
    "  isSecurityCheckBypassed: rp,",
    "  requestBrowserHistory: async (parameters, promptOptions) => await $T(ts, parameters, promptOptions),",
    "  requestFileTransfer: async (transferKind, currentUrl, promptOptions) => await Yk(ts, transferKind, currentUrl, promptOptions),",
    "  requestFullCdp: async (url, promptOptions) => await Zk(ts, url, promptOptions),",
    "  requestOriginConsent: async (origin, promptOptions) => await qT(ts, origin, promptOptions),",
    "  requestPageAssetDownload: async (pageUrl, promptOptions) => await Xk(ts, pageUrl, promptOptions),",
    "  requestPageAssetFallbackFetch: async (pageUrl, assetUrl, promptOptions) => await Qk(ts, pageUrl, assetUrl, promptOptions),",
    "});",
    "",
  ].join("\n");
  const withoutClass = `${source.slice(0, classStart)}${adapter}${source.slice(elicitationStart)}`;
  const adjustedHelperStart = withoutClass.indexOf(helperStartAnchor, classStart);
  const adjustedNextModuleStart = withoutClass.indexOf(
    nextModuleAnchor,
    adjustedHelperStart,
  );
  const transformed = `${withoutClass.slice(0, adjustedHelperStart)}${withoutClass.slice(adjustedNextModuleStart)}`;

  const rawClassStart = rawInput.indexOf('var FH=new Set(["navigate_tab_url"])');
  const rawElicitationStart = rawInput.indexOf("function ts()", rawClassStart);
  const rawHelperStart = rawInput.indexOf("function jH(", rawElicitationStart);
  const rawNextModuleStart = rawInput.indexOf(
    'import{randomUUID as YH}from"node:crypto"',
    rawHelperStart,
  );
  if (
    rawClassStart < 0 ||
    rawElicitationStart < 0 ||
    rawHelperStart < 0 ||
    rawNextModuleStart < 0
  ) {
    throw new Error("Raw Browser Security anchors were not found.");
  }
  return {
    source: transformed,
    mapping: {
      inputRanges: [
        { start: rawClassStart, end: rawElicitationStart },
        { start: rawHelperStart, end: rawNextModuleStart },
      ],
      classification: "reconstructed",
    },
  };
}

function replaceFormattedTabs(source, rawInput) {
  const startAnchor = "var ep = class {";
  const nextAnchor = "var tp = class {";
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(nextAnchor, start);
  if (start < 0 || end < 0) {
    throw new Error("Formatted BrowserTabs anchors were not found.");
  }
  const rawStart = rawInput.indexOf("var ep=class{");
  const rawEnd = rawInput.indexOf("var tp=class{", rawStart);
  if (rawStart < 0 || rawEnd < 0) {
    throw new Error("Raw BrowserTabs anchors were not found.");
  }
  const replacement =
    'import { BrowserTabs as ep } from "./runtime/tabs.ts";\n';
  return {
    source: `${source.slice(0, start)}${replacement}${source.slice(end)}`,
    mapping: {
      inputStart: rawStart,
      inputEnd: rawEnd,
      classification: "reconstructed",
    },
  };
}

async function main() {
  if (unexpectedArguments.length > 0) {
    throw new Error("Usage: bun run materialize-runtime [--force]");
  }
  if (Bun.version !== "1.2.20") {
    throw new Error(`Expected Bun 1.2.20, received ${Bun.version}.`);
  }
  await assertWritableTargetPolicy();
  const input = await readFile(inputPath, "utf8");
  const inputHash = sha256(input);
  if (inputHash !== expectedInputHash) {
    throw new Error(
      `Verified Browser Client input drifted: expected ${expectedInputHash}, received ${inputHash}.`,
    );
  }

  const processResult = replaceProcessShim(input);
  const initiallyFormatted = await format(processResult.source, {
    parser: "babel",
    printWidth: 100,
    semi: true,
    singleQuote: false,
    trailingComma: "all",
  });
  const tabsResult = replaceFormattedTabs(initiallyFormatted, input);
  const securityResult = replaceFormattedBrowserSecurity(tabsResult.source, input);
  const displayResult = replaceFormattedNodeReplDisplay(securityResult.source, input);
  const formatted = await format(displayResult.source, {
    parser: "babel",
    printWidth: 100,
    semi: true,
    singleQuote: false,
    trailingComma: "all",
  });
  const header = [
    "// Deterministic semantic-equivalent compatibility kernel.",
    "// Generated from the immutable published bundle; not the authors' original source.",
    "// Production builds consume this checked-in file and never read scripts-bak.",
    "",
  ].join("\n");
  const output = `${header}${formatted}`;
  await writeFile(outputPath, output, "utf8");

  const evidence = {
    version: 1,
    terminology:
      "semantic-equivalent source recovery / maintainable modular reconstruction",
    input: {
      path: path.relative(workspaceRoot, inputPath),
      sha256: inputHash,
      bytes: Buffer.byteLength(input),
    },
    output: {
      path: path.relative(workspaceRoot, outputPath),
      sha256: sha256(output),
      bytes: Buffer.byteLength(output),
      formatter: { name: "prettier", version: "3.6.2", parser: "babel" },
    },
    extractedModules: {
      processShim: {
        ...processResult.mapping,
        target: "components/codex-plugin/src/browser-client/runtime/process-shim.ts",
        confidence: "confirmed",
      },
      browserTabs: {
        ...tabsResult.mapping,
        target: "components/codex-plugin/src/browser-client/runtime/tabs.ts",
        confidence: "confirmed",
      },
      browserSecurity: {
        ...securityResult.mapping,
        target: "components/codex-plugin/src/browser-client/security/browser-security.ts",
        confidence: "confirmed",
      },
      nodeReplDisplayBridge: {
        ...displayResult.mapping,
        target:
          "components/codex-plugin/src/browser-client/runtime/node-repl-display.ts",
        confidence: "confirmed",
      },
    },
    unresolved:
      "The remaining generated kernel is behavior-preserving recovered JavaScript pending further TypeScript module extraction.",
  };
  await writeFile(evidenceMapPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `Materialized ${path.relative(workspaceRoot, outputPath)} (${evidence.output.sha256}).`,
  );
}

await main();
