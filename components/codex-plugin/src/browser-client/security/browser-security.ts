import type { BrowserTabRecord } from "../runtime/tabs.ts";

type FileTransferKind = "download" | "upload";
type SecurityOperation =
  | "browser-history-read"
  | "browser-origin-access"
  | "file-download"
  | "file-upload"
  | "full-cdp"
  | "page-asset-cross-origin-fetch"
  | "page-asset-download"
  | "raw-cdp-destination-url";

interface BrowserTabsForSecurity {
  get(tabId: number): Promise<BrowserTabRecord>;
}

interface BrowserCommand {
  type: string;
  params?: unknown;
}

interface HistoryRequest {
  date_range: string;
  max_results: number;
  queries?: string[];
}

interface BrowserSecurityDependencies {
  checkDegradedHost(url: unknown, backend: string): Promise<void>;
  checkSiteStatus(url: unknown, backend: string, promptOptions: unknown): Promise<void>;
  extractOrigin(url: unknown): string | null | undefined;
  formatBrowserName(promptOptions: unknown): string;
  formatSecurityError(message: string): string;
  isNavigationUrlAllowed(url: string): boolean;
  isOperationWithoutUserConsent(operation: SecurityOperation): boolean;
  isSecurityCheckBypassed(check: "check-navigation-url-policy"): boolean;
  requestBrowserHistory(parameters: HistoryRequest, promptOptions: unknown): Promise<void>;
  requestFileTransfer(
    transferKind: FileTransferKind,
    currentUrl: string,
    promptOptions: unknown,
  ): Promise<void>;
  requestFullCdp(originUrl: unknown, promptOptions: unknown): Promise<void>;
  requestOriginConsent(origin: string, promptOptions: unknown): Promise<void>;
  requestPageAssetDownload(pageUrl: unknown, promptOptions: unknown): Promise<void>;
  requestPageAssetFallbackFetch(
    pageUrl: unknown,
    assetUrl: unknown,
    promptOptions: unknown,
  ): Promise<void>;
}

type CommandSecurityTarget =
  | { kind: "none" }
  | { kind: "targetUrl"; url: unknown }
  | { kind: "currentTab"; tabId: number };

const HISTORY_COMMAND = "browser_user_history";
const TARGET_URL_COMMANDS = new Set(["navigate_tab_url"]);
const COMMANDS_WITHOUT_ORIGIN_CHECK = new Set([
  "browser_user_claim_tab",
  "browser_user_open_tabs",
  "close_tab",
  "create_tab",
  "list_tabs",
  "mark_tab",
  "name_session",
  "playwright_wait_for_timeout",
  "selected_tab",
]);

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function property(value: unknown, name: string): unknown {
  return objectRecord(value)?.[name];
}

function positiveTabId(parameters: unknown): number | null {
  const tabId = Number(property(parameters, "tab_id"));
  return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
}

export function classifyBrowserSecurityTarget(
  command: BrowserCommand,
): CommandSecurityTarget {
  if (COMMANDS_WITHOUT_ORIGIN_CHECK.has(command.type)) return { kind: "none" };
  if (TARGET_URL_COMMANDS.has(command.type)) {
    return { kind: "targetUrl", url: property(command.params, "url") };
  }
  const tabId = positiveTabId(command.params);
  return tabId == null ? { kind: "none" } : { kind: "currentTab", tabId };
}

function copyStringArray(
  source: Record<string, unknown>,
  target: HistoryRequest,
  propertyName: "queries",
): void {
  const value = source[propertyName];
  if (!Array.isArray(value)) return;
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return;
    strings.push(item);
  }
  target[propertyName] = strings;
}

function formattedDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(timestamp));
}

function formattedDateRange(from: unknown, to: unknown): string {
  const formattedFrom = formattedDate(from);
  const formattedTo = formattedDate(to);
  return formattedFrom != null && formattedTo != null
    ? `${formattedFrom} to ${formattedTo}`
    : formattedFrom != null
      ? `Since ${formattedFrom}`
      : formattedTo != null
        ? `Before ${formattedTo}`
        : "All history";
}

export function buildBrowserHistoryRequest(parameters: unknown): HistoryRequest {
  const source = objectRecord(parameters);
  if (source == null) return { max_results: 100, date_range: "All history" };
  const result: HistoryRequest = {
    date_range: formattedDateRange(source.from, source.to),
    max_results: typeof source.limit === "number" ? source.limit : 100,
  };
  copyStringArray(source, result, "queries");
  return result;
}

export function createBrowserSecurityClass(
  dependencies: BrowserSecurityDependencies,
) {
  return class BrowserSecurity {
    constructor(
      private readonly tabs: BrowserTabsForSecurity,
      private readonly browserBackend: string,
      private readonly promptOptions: unknown = {},
    ) {}

    async ensureCommandAllowed(command: BrowserCommand): Promise<void> {
      if (command.type === HISTORY_COMMAND) {
        if (dependencies.isOperationWithoutUserConsent("browser-history-read")) return;
        await dependencies.requestBrowserHistory(
          buildBrowserHistoryRequest(command.params),
          this.promptOptions,
        );
        return;
      }
      const target = classifyBrowserSecurityTarget(command);
      switch (target.kind) {
        case "none":
          return;
        case "targetUrl":
          await this.ensureTargetUrlOriginAllowed(target.url);
          return;
        case "currentTab":
          await this.ensureCurrentTabOriginAllowed(target.tabId);
      }
    }

    async ensureDownloadAllowed(tabId: number): Promise<void> {
      if (!dependencies.isOperationWithoutUserConsent("file-download"))
        await this.ensureCurrentTabFileTransferAllowed(tabId, "download");
    }

    async ensureFileUploadAllowed(tabId: number): Promise<void> {
      if (!dependencies.isOperationWithoutUserConsent("file-upload"))
        await this.ensureCurrentTabFileTransferAllowed(tabId, "upload");
    }

    async ensurePageAssetDownloadAllowed(pageUrl: unknown): Promise<void> {
      if (!dependencies.isOperationWithoutUserConsent("page-asset-download"))
        await dependencies.requestPageAssetDownload(pageUrl, this.promptOptions);
    }

    async ensurePageAssetFallbackFetchAllowed(
      pageUrl: unknown,
      assetUrl: unknown,
    ): Promise<void> {
      if (!dependencies.isOperationWithoutUserConsent("page-asset-cross-origin-fetch"))
        await dependencies.requestPageAssetFallbackFetch(
          pageUrl,
          assetUrl,
          this.promptOptions,
        );
    }

    async ensureFullCdpAllowed(tabId: number): Promise<void> {
      if (dependencies.isOperationWithoutUserConsent("full-cdp")) return;
      const currentUrl = (await this.tabs.get(tabId)).url;
      if (typeof currentUrl !== "string" || currentUrl.trim().length === 0) {
        throw new Error(
          dependencies.formatSecurityError(
            `${this.browserName()} could not determine the current page URL before attempting to use raw CDP.`,
          ),
        );
      }
      await this.ensureRawCdpUrlAllowedForOperation(currentUrl, "full-cdp");
    }

    async ensureRawCdpUrlAllowed(url: unknown): Promise<void> {
      await this.ensureRawCdpUrlAllowedForOperation(url, "raw-cdp-destination-url");
    }

    private async ensureRawCdpUrlAllowedForOperation(
      url: unknown,
      operation: "full-cdp" | "raw-cdp-destination-url",
    ): Promise<void> {
      await this.ensureUrlPolicyAllowed(url);
      if (!dependencies.isOperationWithoutUserConsent(operation))
        await dependencies.requestFullCdp(url, this.promptOptions);
    }

    async ensureTargetUrlOriginAllowed(url: unknown): Promise<void> {
      await this.ensureUrlPolicyAllowed(url);
      await dependencies.checkDegradedHost(url, this.browserBackend);
      await this.ensureUrlOriginConsentAllowed(url);
    }

    async ensureUrlOriginAllowed(url: unknown): Promise<void> {
      await this.ensureUrlPolicyAllowed(url);
      await this.ensureUrlOriginConsentAllowed(url);
    }

    async ensureUrlOriginConsentAllowed(url: unknown): Promise<void> {
      if (dependencies.isOperationWithoutUserConsent("browser-origin-access")) return;
      const origin = dependencies.extractOrigin(url);
      if (origin != null)
        await dependencies.requestOriginConsent(origin, this.promptOptions);
    }

    async ensureUrlPolicyAllowed(url: unknown): Promise<void> {
      if (
        !dependencies.isSecurityCheckBypassed("check-navigation-url-policy") &&
        typeof url === "string" &&
        !dependencies.isNavigationUrlAllowed(url)
      ) {
        const browserName = this.browserName();
        throw new Error(
          dependencies.formatSecurityError(
            `${browserName} cannot visit the requested page because its URL is blocked by the ${browserName} URL policy.`,
          ),
        );
      }
      await dependencies.checkSiteStatus(url, this.browserBackend, this.promptOptions);
    }

    async ensureCurrentTabOriginAllowed(tabId: number): Promise<void> {
      const tab = await this.tabs.get(tabId);
      await this.ensureUrlOriginAllowed(tab.url);
    }

    async ensureCurrentTabFileTransferAllowed(
      tabId: number,
      transferKind: FileTransferKind,
    ): Promise<void> {
      const currentUrl = (await this.tabs.get(tabId)).url;
      if (typeof currentUrl !== "string" || currentUrl.trim().length === 0) {
        throw new Error(
          dependencies.formatSecurityError(
            `${this.browserName()} could not determine the current page URL before attempting to ${transferKind} files.`,
          ),
        );
      }
      await dependencies.requestFileTransfer(
        transferKind,
        currentUrl,
        this.promptOptions,
      );
    }

    browserName(): string {
      return dependencies.formatBrowserName(this.promptOptions);
    }
  };
}
