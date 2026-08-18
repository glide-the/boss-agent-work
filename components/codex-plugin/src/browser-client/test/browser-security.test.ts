import { describe, expect, test } from "bun:test";

import {
  buildBrowserHistoryRequest,
  classifyBrowserSecurityTarget,
  createBrowserSecurityClass,
} from "../security/browser-security.ts";

function createFixture({ currentUrl = "https://example.com/path" } = {}) {
  const events: string[] = [];
  const dependencies = {
    async checkDegradedHost(): Promise<void> {
      events.push("degraded-host");
    },
    async checkSiteStatus(): Promise<void> {
      events.push("site-status");
    },
    extractOrigin(url: unknown): string | null {
      events.push("extract-origin");
      return typeof url === "string" ? new URL(url).origin : null;
    },
    formatBrowserName(): string {
      return "Chrome";
    },
    formatSecurityError(message: string): string {
      return `secured:${message}`;
    },
    isNavigationUrlAllowed(): boolean {
      events.push("url-policy");
      return true;
    },
    isOperationWithoutUserConsent(operation: string): boolean {
      events.push(`operation:${operation}`);
      return false;
    },
    isSecurityCheckBypassed(): boolean {
      events.push("bypass-navigation-policy");
      return false;
    },
    async requestBrowserHistory(): Promise<void> {
      events.push("history-consent");
    },
    async requestFileTransfer(transferKind: string): Promise<void> {
      events.push(`file-${transferKind}`);
    },
    async requestFullCdp(): Promise<void> {
      events.push("full-cdp-consent");
    },
    async requestOriginConsent(): Promise<void> {
      events.push("origin-consent");
    },
    async requestPageAssetDownload(): Promise<void> {
      events.push("asset-download");
    },
    async requestPageAssetFallbackFetch(): Promise<void> {
      events.push("asset-fallback");
    },
  };
  const Security = createBrowserSecurityClass(dependencies);
  const security = new Security(
    {
      async get() {
        events.push("tab-read");
        return { id: 7, url: currentUrl };
      },
    },
    "extension",
    { elicitationDisplayName: "Chrome" },
  );
  return { dependencies, events, security };
}

describe("Browser Security semantic reconstruction", () => {
  test("classifies no-origin, target URL, and current-tab commands", () => {
    expect(classifyBrowserSecurityTarget({ type: "list_tabs" })).toEqual({ kind: "none" });
    expect(
      classifyBrowserSecurityTarget({ type: "navigate_tab_url", params: { url: "https://x.test" } }),
    ).toEqual({ kind: "targetUrl", url: "https://x.test" });
    expect(classifyBrowserSecurityTarget({ type: "cua_click", params: { tab_id: "7" } })).toEqual({
      kind: "currentTab",
      tabId: 7,
    });
  });

  test("preserves target URL policy, site status, degraded host, and origin consent order", async () => {
    const { events, security } = createFixture();
    await security.ensureCommandAllowed({
      type: "navigate_tab_url",
      params: { url: "https://example.com/next" },
    });
    expect(events).toEqual([
      "bypass-navigation-policy",
      "url-policy",
      "site-status",
      "degraded-host",
      "operation:browser-origin-access",
      "extract-origin",
      "origin-consent",
    ]);
  });

  test("keeps file-transfer and raw CDP authorization independent", async () => {
    const { events, security } = createFixture();
    await security.ensureFileUploadAllowed(7);
    await security.ensureFullCdpAllowed(7);
    expect(events).toEqual([
      "operation:file-upload",
      "tab-read",
      "file-upload",
      "operation:full-cdp",
      "tab-read",
      "bypass-navigation-policy",
      "url-policy",
      "site-status",
      "operation:full-cdp",
      "full-cdp-consent",
    ]);
  });

  test("preserves missing current URL error text", async () => {
    const { security } = createFixture({ currentUrl: "" });
    await expect(security.ensureDownloadAllowed(7)).rejects.toThrow(
      "secured:Chrome could not determine the current page URL before attempting to download files.",
    );
  });

  test("reconstructs history request defaults and query handling", () => {
    expect(buildBrowserHistoryRequest(undefined)).toEqual({
      date_range: "All history",
      max_results: 100,
    });
    expect(
      buildBrowserHistoryRequest({
        from: "not-a-date",
        limit: 5,
        queries: ["codex", "browser"],
      }),
    ).toEqual({
      date_range: "Since not-a-date",
      max_results: 5,
      queries: ["codex", "browser"],
    });
  });
});
