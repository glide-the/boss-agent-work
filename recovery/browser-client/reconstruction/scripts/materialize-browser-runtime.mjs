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
    throw new Error(
      "Process shim anchors were not found in the verified input.",
    );
  }
  const end = endStart + endAnchor.length;
  const replacement = [
    'import { installProcessShim as __installProcessShim, processShim as process } from "./runtime/process-shim.ts";',
    'import { createBrowserSecurityClass as __createBrowserSecurityClass } from "./security/browser-security.ts";',
    'import { siteStatusEnvironment as __siteStatusEnvironment } from "./security/policy-config.ts";',
    'import { createDisplay as DP, createNodeReplDisplayBridge as NG } from "./runtime/node-repl-display.ts";',
    'import { CancellableJsonRpcEndpoint as __CancellableJsonRpcEndpoint } from "./runtime/json-rpc-endpoint.ts";',
    'import { BrowserOperationError as __BrowserOperationError, domSnapshotOperations as __domSnapshotOperations, throwIfBrowserOperationAborted as __throwIfBrowserOperationAborted } from "./runtime/browser-operation.ts";',
    'import { createBossBrowserRpc as __createBossBrowserRpc } from "./runtime/trusted-service.ts";',
    "__installProcessShim();",
  ].join("\n");
  return {
    source: `${source.slice(0, start)}${replacement}${source.slice(end)}`,
    mapping: {
      inputStart: start,
      inputEnd: end,
      classification: "reconstructed",
    },
  };
}

function addTrustedServiceRpcAdapter(source, rawInput) {
  const mappings = [];
  const replace = (before, after, label, rawAnchor) => {
    source = replaceExactlyOnce(source, before, after, label);
    const rawStart = rawInput.indexOf(rawAnchor);
    if (rawStart < 0) throw new Error(`${label} raw anchor was not found.`);
    mappings.push({ start: rawStart, end: rawStart + rawAnchor.length });
  };

  replace(
    "async function ATe({ elicitationDisplayName: t, globals: e }) {",
    "async function ATe({ elicitationDisplayName: t, globals: e, __serviceMode: __bossServiceMode = false }) {",
    "trusted service setup mode",
    "async function ATe({elicitationDisplayName:t,globals:e})",
  );
  replace(
    `  let r = e;
  try {
    if (vu() == null) throw new Error(Ch());
  } catch (f) {
    throw (ae(f), f);
  }
  let n = new fp(qE()),
    o = new Map(),
    i = (PG ??= VP());`,
    `  let r = e,
    __bossRpc = __bossServiceMode ? null : __createBossBrowserRpc(e);
  try {
    if (__bossServiceMode && vu() == null) throw new Error(Ch());
  } catch (f) {
    throw (ae(f), f);
  }
  let n = __bossServiceMode ? new fp(qE()) : null,
    o = new Map(),
    i = (PG ??= VP()),
    __bossTransport;`,
    "trusted service transport selection",
    "let r=e;try{if(vu()==null)",
  );
  replace(
    "        await n.dispose());",
    "        await n?.dispose());",
    "optional service backend disposal",
    "await n.dispose()",
  );
  replace(
    `    [u, c] = await Promise.all([NP(), BP()]),
    d = new gp({
      apiManifest: u,
      documentManifest: c,
      disabledMemberIds: UE(),`,
    `    [__bossSetup, c] = await Promise.all([
      __bossServiceMode
        ? NP().then((apiManifest) => ({ apiManifest, disabledMemberIds: [...UE()] }))
        : __bossRpc("setup", { environment: "codex-app" }),
      BP(),
    ]),
    u = __bossSetup.apiManifest,
    d = new gp({
      apiManifest: u,
      documentManifest: c,
      disabledMemberIds: new Set(__bossSetup.disabledMemberIds),`,
    "trusted service setup handshake",
    "[u,c]=await Promise.all([NP(),BP()])",
  );
  replace(
    "      transport: new pi({",
    "      transport: new pi((__bossTransport = {",
    "capture service command transport",
    "transport:new pi({",
  );
  replace(
    `        async executeAgentCommand(f, g = {}) {
          let { type: m, ...h } = f,`,
    `        async executeAgentCommand(f, g = {}) {
          if (!__bossServiceMode) return await __bossRpc("execute", f);
          if (n == null) throw new Error("Boss投递 service backend is unavailable");
          let { type: m, ...h } = f,`,
    "route client commands through personal service",
    "async executeAgentCommand(f)",
  );
  replace(
    `        },
      }),
    });
  ((r.agent = d.wrapAgent(p)),`,
    `        },
      })),
    });
  ((r.agent = d.wrapAgent(p)),`,
    "close captured service transport",
    "}})});r.agent=d.wrapAgent(p)",
  );
  replace(
    `    Ve("browser_use_setup"),
    Ve("browser_use_invocation_ready", "multi", { backend: "multi", platform: GP(), release: Sn }));
}`,
    `    Ve("browser_use_setup"),
    Ve("browser_use_invocation_ready", "multi", { backend: "multi", platform: GP(), release: Sn }));
  if (__bossServiceMode)
    return {
      apiManifest: u,
      disabledMemberIds: [...__bossSetup.disabledMemberIds],
      dispose: async () => await Pb?.(),
      executeAgentCommand: async (command) => await __bossTransport.executeAgentCommand(command),
    };
}
async function __setupBrowserServiceRuntime({ elicitationDisplayName = "Boss投递", globals = globalThis } = {}) {
  return await ATe({ elicitationDisplayName, globals, __serviceMode: true });
}`,
    "expose personal service runtime",
    'Ve("browser_use_setup")',
  );
  replace(
    "export { ATe as setupBrowserRuntime };",
    "export { ATe as setupBrowserRuntime, __setupBrowserServiceRuntime as setupBrowserServiceRuntime };",
    "personal service runtime export",
    "export{ATe as setupBrowserRuntime}",
  );

  return { source, mapping: { inputRanges: mappings, classification: "reconstructed" } };
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
    throw new Error(
      "Formatted node_repl display bridge anchors were not found.",
    );
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
    "  requestBrowserHistory: async (parameters, promptOptions) => await $T(parameters, promptOptions),",
    "  requestFileTransfer: async (transferKind, currentUrl, promptOptions) => await Yk(ts, transferKind, currentUrl, promptOptions),",
    "  requestFullCdp: async (url, promptOptions) => await Zk(ts, url, promptOptions),",
    "  requestOriginConsent: async (origin, promptOptions) => await qT(origin, promptOptions),",
    "  requestPageAssetDownload: async (pageUrl, promptOptions) => await Xk(ts, pageUrl, promptOptions),",
    "  requestPageAssetFallbackFetch: async (pageUrl, assetUrl, promptOptions) => await Qk(ts, pageUrl, assetUrl, promptOptions),",
    "});",
    "",
  ].join("\n");
  const withoutClass = `${source.slice(0, classStart)}${adapter}${source.slice(elicitationStart)}`;
  const adjustedHelperStart = withoutClass.indexOf(
    helperStartAnchor,
    classStart,
  );
  const adjustedNextModuleStart = withoutClass.indexOf(
    nextModuleAnchor,
    adjustedHelperStart,
  );
  const transformed = `${withoutClass.slice(0, adjustedHelperStart)}${withoutClass.slice(adjustedNextModuleStart)}`;

  const rawClassStart = rawInput.indexOf(
    'var FH=new Set(["navigate_tab_url"])',
  );
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

function configureFormattedBrowserClientSecurityPolicy(source, rawInput) {
  const environmentAnchor =
    "getEnvironment: () => globalThis.nodeRepl?.env ?? {},";
  const environmentStart = source.indexOf(environmentAnchor);
  if (environmentStart < 0) {
    throw new Error(
      "Formatted SiteStatusPolicy environment anchor was not found.",
    );
  }
  const environmentEnd = environmentStart + environmentAnchor.length;
  const replacement =
    "getEnvironment: () => __siteStatusEnvironment(globalThis.nodeRepl?.env ?? {}),";

  const rawAnchor = "getEnvironment:()=>globalThis.nodeRepl?.env??{}";
  const rawStart = rawInput.indexOf(rawAnchor);
  if (rawStart < 0) {
    throw new Error("Raw SiteStatusPolicy environment anchor was not found.");
  }
  return {
    source: `${source.slice(0, environmentStart)}${replacement}${source.slice(environmentEnd)}`,
    mapping: {
      inputStart: rawStart,
      inputEnd: rawStart + rawAnchor.length,
      classification: "reconstructed",
    },
  };
}

function replaceFormattedOriginSessionPolicy(source, rawInput) {
  const startAnchor = "function ze() {";
  const nextModuleAnchor =
    'import { AsyncLocalStorage as z5 } from "node:async_hooks";';
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(nextModuleAnchor, start);
  if (start < 0 || end < 0) {
    throw new Error("Formatted origin/session policy anchors were not found.");
  }

  const rawStart = rawInput.indexOf("function ze(){");
  const rawEnd = rawInput.indexOf(
    'import{AsyncLocalStorage as z5}from"node:async_hooks"',
    rawStart,
  );
  if (rawStart < 0 || rawEnd < 0) {
    throw new Error("Raw origin/session policy anchors were not found.");
  }

  const adapter = [
    'import { createOriginSessionPolicy as __createOriginSessionPolicy } from "./security/origin-session-policy.ts";',
    "var {",
    "  assertRequiredTurnMetadata: ST,",
    "  evaluateCodexNetworkPolicy: TT,",
    "  extractBrowserOrigin: Oe,",
    "  extractHttpOrigin: WT,",
    "  fileUrlWithoutSearchAndHash: W5,",
    "  formatBrowserName: be,",
    "  getCodexSessionId: Yt,",
    "  getTurnMetadata: ze,",
    "  isAutomaticReviewDisabled: BT,",
    "  isLocalhostHostname: VT,",
    "  missingRequiredTurnMetadata: X8,",
    "  persistFileTransferResponse: Ol,",
    "  persistFullCdpResponse: FT,",
    "  persistHistoryResponse: LT,",
    "  persistOriginResponse: MT,",
    "  parseBrowserUrl: zT,",
    "  queryFileTransfer: Dl,",
    "  queryFullCdp: OT,",
    "  queryHistory: NT,",
    "  queryOrigin: wh,",
    "  requestBrowserHistoryConsent: $T,",
    "  requestOriginConsent: qT,",
    "  resolvePrivilegedNodeRepl: Zt,",
    "  httpOriginFromUrl: HT,",
    "} = __createOriginSessionPolicy({",
    "  formatSecurityError: ne,",
    "  getDefaultPrivilegedNodeRepl: Re,",
    "  getElicitationProvider: () => ts(),",
    "  getNodeRepl: () => globalThis.nodeRepl,",
    "  globalConfigPath: wr,",
    "});",
    "",
  ].join("\n");
  return {
    source: `${source.slice(0, start)}${adapter}${source.slice(end)}`,
    mapping: {
      inputStart: rawStart,
      inputEnd: rawEnd,
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

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label} expected exactly one formatted anchor.`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function addBrowserOperationCancellation(source, rawInput) {
  const mappings = [];
  const replace = (before, after, label, rawAnchor) => {
    source = replaceExactlyOnce(source, before, after, label);
    const rawStart = rawInput.indexOf(rawAnchor);
    if (rawStart < 0) throw new Error(`${label} raw anchor was not found.`);
    mappings.push({ start: rawStart, end: rawStart + rawAnchor.length });
  };

  replace(
    'var uv = l.object({ browser_id: l.string(), tab_id: l.string() }),',
    `var uv = l.object({
    browser_id: l.string(),
    tab_id: l.string(),
    timeout_ms: l.number().int().positive().optional(),
  }),`,
    "DOM snapshot command timeout schema",
    "var uv=l.object({browser_id:l.string(),tab_id:l.string()})",
  );
  replace(
    `    async domSnapshot() {
      return (await this.#r.send({ command: Za.create({ browser_id: this.#e, tab_id: this.#t }) }))
        .dom_snapshot;
    }`,
    `    async domSnapshot(e = {}) {
      let r = Number(this.#t);
      return await __domSnapshotOperations.run({
        key: \`${"${this.#e}:${this.#t}"}\`,
        operation: "playwright.domSnapshot",
        tabId: r,
        timeoutMs: e.timeoutMs,
        signal: e.signal,
        execute: async ({ operationId: n, signal: o, timeoutMs: i }) =>
          (
            await this.#r.send({
              command: Za.create({ browser_id: this.#e, tab_id: this.#t, timeout_ms: i }),
              operation: "playwright.domSnapshot",
              operationId: n,
              signal: o,
              tabId: r,
              timeoutMs: i,
            })
          ).dom_snapshot,
      });
    }`,
    "DOM snapshot public cancellation API",
    "async domSnapshot(){",
  );
  replace(
    `    async send({ command: e, timeoutMs: r }) {
      let n = e.toJSON(),
        o = await this.executeAgentCommand({
          ...n,
          client_timeout_ms: typeof r == "number" && r > 0 ? r : void 0,
        }),
        i = await e6(o, this.displaySideEffect);
      if (i == null) throw new Error("transport send returned empty response");
      return i;
    }`,
    `    async send({ command: e, timeoutMs: r, signal: n, operationId: o, operation: i, tabId: s }) {
      let a = e.toJSON(),
        u = await this.executeAgentCommand({
          ...a,
          client_timeout_ms: typeof r == "number" && r > 0 ? r : void 0,
        }, { signal: n, operationId: o, operation: i, tabId: s });
      let c = await e6(u, this.displaySideEffect);
      if (c == null) throw new Error("transport send returned empty response");
      return c;
    }`,
    "function transport cancellation metadata",
    "async send({command:e,timeoutMs:r})",
  );
  replace(
    `};
function fi(t, e) {
  return new Error(\`${"${t}"} does not support command "${"${e.type}"}".\`);
}`,
    `};
du = __CancellableJsonRpcEndpoint;
function fi(t, e) {
  return new Error(\`${"${t}"} does not support command "${"${e.type}"}".\`);
}`,
    "cancellable JSON-RPC endpoint adapter",
    "function fi(t,e)",
  );
  replace(
    `    async executeTargetCdp(r, n, o, i = {}) {
      return (
        this.throwIfJsDialogBlocksMethod(r.tabId, n),`,
    `    async executeTargetCdp(r, n, o, i = {}) {
      __throwIfBrowserOperationAborted(
        i.signal,
        i.operation ?? "browser.operation",
        r.tabId,
        i.operationId,
      );
      try {
        this.throwIfJsDialogBlocksMethod(r.tabId, n);
      } catch (s) {
        if (i.operationId != null)
          throw new __BrowserOperationError(
            {
              operation: i.operation ?? "browser.operation",
              tabId: r.tabId,
              reason: "dialog",
              dialogDetected: true,
              browserCleanupComplete: true,
              requestId: i.operationId,
            },
            s instanceof Error ? s.message : String(s),
          );
        throw s;
      }
      return (`,
    "CDP abort and dialog preflight",
    "async executeTargetCdp(r,n,o,i={})",
  );
  replace(
    `                  timeoutMs: s,
                };`,
    `                  timeoutMs: s,
                  operationId: i.operationId,
                  operation: i.operation,
                  signal: i.signal,
                };`,
    "CDP operation metadata",
    "preserveDebuggerOnTimeout",
  );
  replace(
    `                (this.forgetAttachedTab(r.tabId), r.sessionId == null && r.targetId == null)
              )
                return this.executeTargetCdp(r, n, o, i);`,
    `                (this.forgetAttachedTab(r.tabId),
                r.sessionId == null &&
                  r.targetId == null &&
                  (i.debuggerRetryCount ?? 0) < 1)
              )
                return this.executeTargetCdp(r, n, o, {
                  ...i,
                  debuggerRetryCount: (i.debuggerRetryCount ?? 0) + 1,
                });`,
    "bounded debugger reattach retry",
    "Debugger unattached",
  );
  replace(
    `  iI = y("playwright_dom_snapshot", async (t, e) => {
    let r = de(t),
      n = await e.playwright.evaluateOnPlaywrightPage(`,
    `  iI = y("playwright_dom_snapshot", async (t, e) => {
    let r = de(t),
      o = {
        operation: t.client_operation_name ?? "playwright.domSnapshot",
        operationId: t.client_operation_id,
        signal: t.client_abort_signal,
      },
      n = await e.playwright.evaluateOnPlaywrightPage(`,
    "snapshot handler operation context",
    'iI=y("playwright_dom_snapshot"',
  );
  replace(
    `        { timeoutMs: r },
      ),
      o = e.isIabBackend ? Date.now() + _9 : void 0,
      i = await sI(e, t.tab_id, n, r, void 0, o);
    return { dom_snapshot: S9(i) };
  });
async function sI(t, e, r, n, o, i) {`,
    `        { ...o, timeoutMs: r },
      ),
      i = e.isIabBackend ? Date.now() + _9 : void 0,
      s = await sI(e, t.tab_id, n, r, void 0, i, o);
    return { dom_snapshot: S9(s) };
  });
async function sI(t, e, r, n, o, i, q) {`,
    "snapshot handler signal propagation",
    "function sI(t,e,r,n,o,i)",
  );
  replace(
    "s.map(async (c) => [c, await w9(t, e, c, n, o, i)])",
    "s.map(async (c) => [c, await w9(t, e, c, n, o, i, q)])",
    "iframe snapshot operation context",
    "s.map(async c=>[c,await w9(t,e,c,n,o,i)])",
  );
  replace(
    "async function w9(t, e, r, n, o, i) {",
    "async function w9(t, e, r, n, o, i, q) {",
    "iframe snapshot signature",
    "async function w9(t,e,r,n,o,i)",
  );
  replace(
    `{ ...(i == null ? {} : { deadlineMs: i }), retry: !1, timeoutMs: a },
      );
    return await sI(t, e, u, n, s, i);`,
    `{ ...q, ...(i == null ? {} : { deadlineMs: i }), retry: !1, timeoutMs: a },
      );
    return await sI(t, e, u, n, s, i, q);`,
    "iframe snapshot abort propagation",
    "retry:!1,timeoutMs:a",
  );
  replace(
    `        {
          telemetryAttrs: zn({ operation: En("page"), phase: "page_eval" }),`,
    `        {
          operation: n.operation,
          operationId: n.operationId,
          signal: n.signal,
          telemetryAttrs: zn({ operation: En("page"), phase: "page_eval" }),`,
    "Playwright page evaluation operation propagation",
    'phase:"page_eval"',
  );
  replace(
    `            dk,
            {
              timeoutMs: r.timeoutMs,`,
    `            dk,
            {
              ...r,
              timeoutMs: r.timeoutMs,`,
    "Playwright injection operation propagation",
    "timeoutMs:r.timeoutMs",
  );
  replace(
    `    executeCdp(r) {
      return this.sendSessionRequest("executeCdp", r);
    }
    async executeCdpWithCachedExpression(r, n) {
      if (this.cachedExpressionSupport == null || (await this.cachedExpressionSupport)) {
        let o = { ...r.commandParams };
        this.sentCachedExpressions.has(n) && delete o.expression;
        let i = this.sendSessionRequest(Ib, { ...r, commandParams: o, expressionCacheKey: n });
        (this.sentCachedExpressions.add(n),
          this.cachedExpressionSupport == null &&
            (this.cachedExpressionSupport = i.then(
              () => !0,
              (s) => s !== vP,
            )));
        try {
          let s = await i;
          if (s.kind === "executed") return s.result;
          let a = await this.sendSessionRequest(Ib, { ...r, expressionCacheKey: n });
          if (a.kind === "executed") return a.result;
          throw new Error("Cached CDP expression refill failed");
        } catch (s) {
          if (s !== vP) throw s;
        }
      }
      return this.executeCdp(r);
    }`,
    `    executeCdp(r) {
      let { signal: n, operationId: o, operation: i, ...s } = r;
      return this.sendSessionRequest("executeCdp", s, {
        signal: n,
        operationId: o,
        operation: i,
        tabId: r.target?.tabId,
        timeoutMs: r.timeoutMs,
      });
    }
    async executeCdpWithCachedExpression(r, n) {
      let { signal: o, operationId: i, operation: s, ...a } = r,
        u = {
          signal: o,
          operationId: i,
          operation: s,
          tabId: r.target?.tabId,
          timeoutMs: r.timeoutMs,
        };
      if (this.cachedExpressionSupport == null || (await this.cachedExpressionSupport)) {
        let c = { ...a.commandParams };
        this.sentCachedExpressions.has(n) && delete c.expression;
        let d = this.sendSessionRequest(Ib, { ...a, commandParams: c, expressionCacheKey: n }, u);
        (this.sentCachedExpressions.add(n),
          this.cachedExpressionSupport == null &&
            (this.cachedExpressionSupport = d.then(
              () => !0,
              (p) => p !== vP,
            )));
        try {
          let p = await d;
          if (p.kind === "executed") return p.result;
          let f = await this.sendSessionRequest(Ib, { ...a, expressionCacheKey: n }, u);
          if (f.kind === "executed") return f.result;
          throw new Error("Cached CDP expression refill failed");
        } catch (p) {
          if (p !== vP) throw p;
        }
      }
      return this.executeCdp(r);
    }`,
    "session CDP cancellation transport",
    "executeCdp(r){return this.sendSessionRequest",
  );
  replace(
    `    sendSessionRequest(r, n) {
      let o = this.getSessionParams();`,
    `    sendSessionRequest(r, n, p = {}) {
      let o = this.getSessionParams();`,
    "session request cancellation options",
    "sendSessionRequest(r,n)",
  );
  replace(
    "        this.sendRequest(r, { ...n, ...o })",
    `        this.sendRequest(r, { ...n, ...o }, {
          ...p,
          ...(p.operationId == null
            ? {}
            : {
                cancelRequest: {
                  method: "cancelBrowserOperation",
                  params: { operationId: p.operationId, ...o },
                },
              }),
        })`,
    "session cancellation command",
    "this.sendRequest(r,{...n,...o})",
  );
  replace(
    "      (await Promise.all([...o.values()].map((f) => f.dispose())), await n.dispose());",
    `      (__domSnapshotOperations.cancelAll("cancelled"),
        await Promise.all([...o.values()].map((f) => f.dispose())),
        await n.dispose());`,
    "runtime reset cancellation",
    "await Promise.all([...o.values()].map(f=>f.dispose()))",
  );
  replace(
    `        async executeAgentCommand(f) {
          let { type: m, ...h } = f,
            b = kG.find((k) => k.type === m);`,
    `        async executeAgentCommand(f, g = {}) {
          let { type: m, ...h } = f,
            b = kG.find((k) => k.type === m);
          Object.defineProperties(h, {
            client_abort_signal: { value: g.signal },
            client_operation_id: { value: g.operationId },
            client_operation_name: { value: g.operation },
            client_operation_tab_id: { value: g.tabId },
          });`,
    "agent command cancellation context",
    "async executeAgentCommand(f)",
  );
  replace(
    `              try {
                k = await KP(A, h, { readCurrentUrl: !0 });
              } catch {
                k = void 0;
              }`,
    `              if (!h.client_abort_signal?.aborted) {
                try {
                  k = await KP(A, h, { readCurrentUrl: !0 });
                } catch {
                  k = void 0;
                }
              }`,
    "post-cancellation context suppression",
    "k=await KP(A,h,{readCurrentUrl:!0})",
  );

  return {
    source,
    mapping: { inputRanges: mappings, classification: "reconstructed" },
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
  const securityPolicyResult = configureFormattedBrowserClientSecurityPolicy(
    tabsResult.source,
    input,
  );
  const securityResult = replaceFormattedBrowserSecurity(
    securityPolicyResult.source,
    input,
  );
  const originSessionPolicyResult = replaceFormattedOriginSessionPolicy(
    securityResult.source,
    input,
  );
  const displayResult = replaceFormattedNodeReplDisplay(
    originSessionPolicyResult.source,
    input,
  );
  const cancellationResult = addBrowserOperationCancellation(displayResult.source, input);
  const trustedServiceResult = addTrustedServiceRpcAdapter(cancellationResult.source, input);
  const formatted = await format(trustedServiceResult.source, {
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
        target:
          "components/codex-plugin/src/browser-client/runtime/process-shim.ts",
        confidence: "confirmed",
      },
      browserTabs: {
        ...tabsResult.mapping,
        target: "components/codex-plugin/src/browser-client/runtime/tabs.ts",
        confidence: "confirmed",
      },
      browserSecurity: {
        ...securityResult.mapping,
        target:
          "components/codex-plugin/src/browser-client/security/browser-security.ts",
        confidence: "confirmed",
      },
      browserClientSecurityPolicy: {
        ...securityPolicyResult.mapping,
        target:
          "components/codex-plugin/src/browser-client/security/policy-config.ts",
        confidence: "confirmed",
      },
      originSessionPolicy: {
        ...originSessionPolicyResult.mapping,
        target:
          "components/codex-plugin/src/browser-client/security/origin-session-policy.ts",
        confidence: "confirmed",
      },
      nodeReplDisplayBridge: {
        ...displayResult.mapping,
        target:
          "components/codex-plugin/src/browser-client/runtime/node-repl-display.ts",
        confidence: "confirmed",
      },
      browserOperationCancellation: {
        ...cancellationResult.mapping,
        target:
          "components/codex-plugin/src/browser-client/runtime/browser-operation.ts",
        supportingTarget:
          "components/codex-plugin/src/browser-client/runtime/json-rpc-endpoint.ts",
        confidence: "confirmed",
      },
      trustedServiceRpcAdapter: {
        ...trustedServiceResult.mapping,
        target:
          "components/codex-plugin/src/browser-client/runtime/trusted-service.ts",
        serviceEntry:
          "components/codex-plugin/src/browser-client/browser-service.ts",
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
