export const SITE_STATUS_CHECK_ENABLED_ENV = "BROWSER_USE_SITE_STATUS_CHECK_ENABLED";
export const SITE_STATUS_BASE_URL_ENV = "BROWSER_USE_SITE_STATUS_BASE_URL";
export const DEFAULT_SITE_STATUS_BASE_URL = "http://127.0.0.1:8787";
export const DEFAULT_SITE_STATUS_TIMEOUT_MS = 2_000;
export const SITE_STATUS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const DEFAULT_URL_REQUEST_SOURCE = "codex_browser_use";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

type Environment = Record<string, unknown>;
type BrowserBackend = "chrome" | "iab" | "cdp" | string | null | undefined;

interface TurnMetadata {
  session_id?: string;
  turn_id?: string;
}

interface SiteStatusConfigurationDisabled {
  enabled: false;
  baseUrl: null;
}

interface SiteStatusConfigurationEnabled {
  enabled: true;
  baseUrl: string;
}

export type SiteStatusConfiguration =
  | SiteStatusConfigurationDisabled
  | SiteStatusConfigurationEnabled;

export interface SiteStatusDiagnostic {
  serviceOrigin: string;
  targetOrigin: string;
  targetPathname: string;
}

export interface SiteStatusRequest {
  cacheKey: string;
  diagnostic: SiteStatusDiagnostic;
  displayUrl: string;
  endpoint: string;
}

interface SiteStatusResponseLike {
  ok?: boolean;
  status?: number;
  json(): Promise<unknown>;
}

type Fetcher = (
  url: string,
  init: { method: "GET"; signal: AbortSignal },
) => Promise<SiteStatusResponseLike> | SiteStatusResponseLike;

export interface SiteStatusFailOpenEvent extends SiteStatusDiagnostic {
  event: "browser_use_site_status_fail_open";
  failureType: string;
}

export interface SiteStatusPolicyOptions {
  cacheTtlMs?: number;
  getEnvironment?: () => Environment;
  getFetch?: () => Fetcher | undefined;
  getTurnMetadata?: () => TurnMetadata | null;
  logger?: (event: SiteStatusFailOpenEvent) => void;
  now?: () => number;
  timeoutMs?: number;
}

export interface ThrowIfBlocksUrlOptions {
  createBlockedError?: (reason: string) => Error;
  displayName?: string;
}

export class SiteStatusConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteStatusConfigurationError";
  }
}

class SiteStatusProtocolError extends Error {
  code: string;
  status: number | undefined;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SiteStatusProtocolError";
    this.code = code;
    this.status = undefined;
  }
}

function environmentValue(environment: Environment, name: string): string {
  const value = environment[name];
  return typeof value === "string" ? value.trim() : "";
}

function parseEnabled(environment: Environment): boolean {
  const value = environmentValue(environment, SITE_STATUS_CHECK_ENABLED_ENV).toLowerCase();
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new SiteStatusConfigurationError(
    `${SITE_STATUS_CHECK_ENABLED_ENV} must be "true", "false", or unset.`,
  );
}

export function resolveSiteStatusConfiguration(
  environment: Environment = {},
): SiteStatusConfiguration {
  const enabled = parseEnabled(environment);
  if (!enabled) return { enabled: false, baseUrl: null };

  const configuredBaseUrl = environmentValue(environment, SITE_STATUS_BASE_URL_ENV)
    || DEFAULT_SITE_STATUS_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(configuredBaseUrl);
  } catch {
    throw new SiteStatusConfigurationError(
      `${SITE_STATUS_BASE_URL_ENV} must be a valid loopback URL.`,
    );
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new SiteStatusConfigurationError(
      `${SITE_STATUS_BASE_URL_ENV} must use 127.0.0.1, localhost, or [::1].`,
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new SiteStatusConfigurationError(`${SITE_STATUS_BASE_URL_ENV} must use http or https.`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new SiteStatusConfigurationError(
      `${SITE_STATUS_BASE_URL_ENV} must not include credentials.`,
    );
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new SiteStatusConfigurationError(
      `${SITE_STATUS_BASE_URL_ENV} must not include a query or fragment.`,
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
  return { enabled: true, baseUrl: parsed.toString() };
}

function isLocalTargetHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "[::1]"
    || normalized === "::1";
}

function normalizedCacheKey(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  return normalized.startsWith("www.") ? normalized.slice(4) : normalized;
}

export interface BuildSiteStatusRequestOptions {
  baseUrl: string;
  conversationId?: string | undefined;
  turnId?: string | undefined;
  urlRequestSource?: string;
}

export function buildSiteStatusRequest(
  targetUrl: string,
  {
    baseUrl,
    conversationId,
    turnId,
    urlRequestSource = DEFAULT_URL_REQUEST_SOURCE,
  }: BuildSiteStatusRequestOptions,
): SiteStatusRequest | null {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    throw new Error("Browser Use cannot check site status because the target URL is invalid.");
  }
  if (!["http:", "https:"].includes(target.protocol)) return null;
  if (target.hostname.trim() === "") {
    throw new Error("Browser Use cannot check site status because the target URL has no host.");
  }
  if (isLocalTargetHostname(target.hostname)) return null;

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const endpoint = new URL("aura/site_status", normalizedBase);
  const requestTarget = new URL(target.origin);
  requestTarget.pathname = target.pathname;
  requestTarget.search = target.search;
  endpoint.searchParams.set("site_url", requestTarget.toString());
  endpoint.searchParams.set("url_request_source", urlRequestSource);
  if (conversationId != null) endpoint.searchParams.set("conversation_id", String(conversationId));
  if (turnId != null) endpoint.searchParams.set("turn_id", String(turnId));

  const displayTarget = new URL(target.origin);
  displayTarget.pathname = target.pathname;
  const displayUrl = displayTarget.pathname === "/"
    ? displayTarget.origin
    : displayTarget.toString();

  return {
    cacheKey: normalizedCacheKey(target.hostname),
    diagnostic: {
      serviceOrigin: endpoint.origin,
      targetOrigin: target.origin,
      targetPathname: target.pathname,
    },
    displayUrl,
    endpoint: endpoint.toString(),
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

export function parseSiteStatusResponse(value: unknown): { blocked: boolean } {
  const featureStatus = objectRecord(objectRecord(value)?.feature_status);
  const agent = featureStatus?.agent;
  if (typeof agent !== "boolean") {
    throw new SiteStatusProtocolError(
      "invalid_response",
      "Site status response must include feature_status.agent as a boolean.",
    );
  }
  return { blocked: agent === false };
}

function errorProperty(error: unknown, name: "name" | "code"): unknown {
  return objectRecord(error)?.[name];
}

function errorCode(error: unknown): string {
  if (errorProperty(error, "name") === "AbortError" || errorProperty(error, "code") === "site_status_timeout") {
    return "timeout";
  }
  if (error instanceof SiteStatusProtocolError) return error.code;
  return "network_error";
}

function defaultLogger(event: SiteStatusFailOpenEvent): void {
  console.warn("[browser-use:site-status]", event);
}

async function fetchWithTimeout(
  fetcher: Fetcher,
  endpoint: string,
  timeoutMs: number,
): Promise<SiteStatusResponseLike> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error = new Error("Site status request timed out.") as Error & { code?: string };
      error.code = "site_status_timeout";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve(fetcher(endpoint, { method: "GET", signal: controller.signal })),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

interface SiteStatusCacheEntry {
  blocked: boolean;
  timestampMs: number;
}

export class SiteStatusPolicy {
  private readonly cacheTtlMs: number;
  private readonly getEnvironment: () => Environment;
  private readonly getFetch: () => Fetcher | undefined;
  private readonly getTurnMetadata: () => TurnMetadata | null;
  private readonly logger: (event: SiteStatusFailOpenEvent) => void;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, SiteStatusCacheEntry>();
  private readonly inflightRequests = new Map<string, Promise<boolean>>();

  constructor({
    cacheTtlMs = SITE_STATUS_CACHE_TTL_MS,
    getEnvironment = () => ({}),
    getFetch = () => globalThis.fetch as unknown as Fetcher,
    getTurnMetadata = () => null,
    logger = defaultLogger,
    now = Date.now,
    timeoutMs = DEFAULT_SITE_STATUS_TIMEOUT_MS,
  }: SiteStatusPolicyOptions = {}) {
    this.cacheTtlMs = cacheTtlMs;
    this.getEnvironment = getEnvironment;
    this.getFetch = getFetch;
    this.getTurnMetadata = getTurnMetadata;
    this.logger = logger;
    this.now = now;
    this.timeoutMs = timeoutMs;
  }

  async throwIfBlocksUrl(
    targetUrl: unknown,
    browserBackend: BrowserBackend,
    {
      createBlockedError,
      displayName = "Chrome",
    }: ThrowIfBlocksUrlOptions = {},
  ): Promise<void> {
    if (typeof targetUrl !== "string") return;
    const configuration = resolveSiteStatusConfiguration(this.getEnvironment?.() ?? {});
    if (!configuration.enabled) return;

    const turnMetadata = this.getTurnMetadata?.();
    const request = buildSiteStatusRequest(targetUrl, {
      baseUrl: configuration.baseUrl,
      conversationId: turnMetadata?.session_id,
      turnId: turnMetadata?.turn_id,
      urlRequestSource: browserBackend == null
        ? DEFAULT_URL_REQUEST_SOURCE
        : `${DEFAULT_URL_REQUEST_SOURCE}:${browserBackend}`,
    });
    if (request == null) return;

    let blocked: boolean;
    try {
      blocked = await this.isBlocked(request);
    } catch (error) {
      this.logFailOpen(error, request.diagnostic);
      return;
    }
    if (!blocked) return;

    const reason = `${displayName} is not permitted on ${request.displayUrl}.`;
    throw typeof createBlockedError === "function" ? createBlockedError(reason) : new Error(reason);
  }

  private async isBlocked(request: SiteStatusRequest): Promise<boolean> {
    const cached = this.cache.get(request.cacheKey);
    if (cached != null && this.now() - cached.timestampMs < this.cacheTtlMs) return cached.blocked;
    if (cached != null) this.cache.delete(request.cacheKey);

    const inflight = this.inflightRequests.get(request.cacheKey);
    if (inflight != null) return await inflight;

    const pending = this.fetchBlocked(request)
      .then((blocked) => {
        this.cache.set(request.cacheKey, { blocked, timestampMs: this.now() });
        return blocked;
      })
      .finally(() => {
        if (this.inflightRequests.get(request.cacheKey) === pending) {
          this.inflightRequests.delete(request.cacheKey);
        }
      });
    this.inflightRequests.set(request.cacheKey, pending);
    return await pending;
  }

  private async fetchBlocked(request: SiteStatusRequest): Promise<boolean> {
    const fetcher = this.getFetch?.();
    if (typeof fetcher !== "function") {
      throw new SiteStatusProtocolError("fetch_unavailable", "Site status fetch is unavailable.");
    }
    const response = await fetchWithTimeout(fetcher, request.endpoint, this.timeoutMs);
    if (response?.ok !== true) {
      const error = new SiteStatusProtocolError(
        "http_error",
        "Site status service returned a non-success status.",
      );
      error.status = response?.status;
      throw error;
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SiteStatusProtocolError("invalid_json", "Site status service returned invalid JSON.");
    }
    return parseSiteStatusResponse(payload).blocked;
  }

  private logFailOpen(error: unknown, diagnostic: SiteStatusDiagnostic): void {
    const event: SiteStatusFailOpenEvent = {
      event: "browser_use_site_status_fail_open",
      failureType: errorCode(error),
      ...diagnostic,
    };
    try {
      this.logger?.(event);
    } catch {
      // Diagnostics must never change fail-open behavior.
    }
  }
}
