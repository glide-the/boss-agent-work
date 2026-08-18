// security/site-status-policy.ts
var SITE_STATUS_CHECK_ENABLED_ENV = "BROWSER_USE_SITE_STATUS_CHECK_ENABLED";
var SITE_STATUS_BASE_URL_ENV = "BROWSER_USE_SITE_STATUS_BASE_URL";
var DEFAULT_SITE_STATUS_BASE_URL = "http://127.0.0.1:8787";
var DEFAULT_SITE_STATUS_TIMEOUT_MS = 2000;
var SITE_STATUS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
var DEFAULT_URL_REQUEST_SOURCE = "codex_browser_use";
var LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

class SiteStatusConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SiteStatusConfigurationError";
  }
}

class SiteStatusProtocolError extends Error {
  code;
  status;
  constructor(code, message) {
    super(message);
    this.name = "SiteStatusProtocolError";
    this.code = code;
    this.status = undefined;
  }
}
function environmentValue(environment, name) {
  const value = environment[name];
  return typeof value === "string" ? value.trim() : "";
}
function parseEnabled(environment) {
  const value = environmentValue(environment, SITE_STATUS_CHECK_ENABLED_ENV).toLowerCase();
  if (value === "" || value === "false")
    return false;
  if (value === "true")
    return true;
  throw new SiteStatusConfigurationError(`${SITE_STATUS_CHECK_ENABLED_ENV} must be "true", "false", or unset.`);
}
function resolveSiteStatusConfiguration(environment = {}) {
  const enabled = parseEnabled(environment);
  if (!enabled)
    return { enabled: false, baseUrl: null };
  const configuredBaseUrl = environmentValue(environment, SITE_STATUS_BASE_URL_ENV) || DEFAULT_SITE_STATUS_BASE_URL;
  let parsed;
  try {
    parsed = new URL(configuredBaseUrl);
  } catch {
    throw new SiteStatusConfigurationError(`${SITE_STATUS_BASE_URL_ENV} must be a valid loopback URL.`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new SiteStatusConfigurationError(`${SITE_STATUS_BASE_URL_ENV} must use 127.0.0.1, localhost, or [::1].`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new SiteStatusConfigurationError(`${SITE_STATUS_BASE_URL_ENV} must use http or https.`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new SiteStatusConfigurationError(`${SITE_STATUS_BASE_URL_ENV} must not include credentials.`);
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new SiteStatusConfigurationError(`${SITE_STATUS_BASE_URL_ENV} must not include a query or fragment.`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
  return { enabled: true, baseUrl: parsed.toString() };
}
function isLocalTargetHostname(hostname) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}
function normalizedCacheKey(hostname) {
  const normalized = hostname.trim().toLowerCase();
  return normalized.startsWith("www.") ? normalized.slice(4) : normalized;
}
function buildSiteStatusRequest(targetUrl, {
  baseUrl,
  conversationId,
  turnId,
  urlRequestSource = DEFAULT_URL_REQUEST_SOURCE
}) {
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    throw new Error("Browser Use cannot check site status because the target URL is invalid.");
  }
  if (!["http:", "https:"].includes(target.protocol))
    return null;
  if (target.hostname.trim() === "") {
    throw new Error("Browser Use cannot check site status because the target URL has no host.");
  }
  if (isLocalTargetHostname(target.hostname))
    return null;
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const endpoint = new URL("aura/site_status", normalizedBase);
  const requestTarget = new URL(target.origin);
  requestTarget.pathname = target.pathname;
  requestTarget.search = target.search;
  endpoint.searchParams.set("site_url", requestTarget.toString());
  endpoint.searchParams.set("url_request_source", urlRequestSource);
  if (conversationId != null)
    endpoint.searchParams.set("conversation_id", String(conversationId));
  if (turnId != null)
    endpoint.searchParams.set("turn_id", String(turnId));
  const displayTarget = new URL(target.origin);
  displayTarget.pathname = target.pathname;
  const displayUrl = displayTarget.pathname === "/" ? displayTarget.origin : displayTarget.toString();
  return {
    cacheKey: normalizedCacheKey(target.hostname),
    diagnostic: {
      serviceOrigin: endpoint.origin,
      targetOrigin: target.origin,
      targetPathname: target.pathname
    },
    displayUrl,
    endpoint: endpoint.toString()
  };
}
function objectRecord(value) {
  return typeof value === "object" && value !== null ? value : null;
}
function parseSiteStatusResponse(value) {
  const featureStatus = objectRecord(objectRecord(value)?.feature_status);
  const agent = featureStatus?.agent;
  if (typeof agent !== "boolean") {
    throw new SiteStatusProtocolError("invalid_response", "Site status response must include feature_status.agent as a boolean.");
  }
  return { blocked: agent === false };
}
function errorProperty(error, name) {
  return objectRecord(error)?.[name];
}
function errorCode(error) {
  if (errorProperty(error, "name") === "AbortError" || errorProperty(error, "code") === "site_status_timeout") {
    return "timeout";
  }
  if (error instanceof SiteStatusProtocolError)
    return error.code;
  return "network_error";
}
function defaultLogger(event) {
  console.warn("[browser-use:site-status]", event);
}
async function fetchWithTimeout(fetcher, endpoint, timeoutMs) {
  const controller = new AbortController;
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error = new Error("Site status request timed out.");
      error.code = "site_status_timeout";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve(fetcher(endpoint, { method: "GET", signal: controller.signal })),
      timeoutPromise
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

class SiteStatusPolicy {
  cacheTtlMs;
  getEnvironment;
  getFetch;
  getTurnMetadata;
  logger;
  now;
  timeoutMs;
  cache = new Map;
  inflightRequests = new Map;
  constructor({
    cacheTtlMs = SITE_STATUS_CACHE_TTL_MS,
    getEnvironment = () => ({}),
    getFetch = () => globalThis.fetch,
    getTurnMetadata = () => null,
    logger = defaultLogger,
    now = Date.now,
    timeoutMs = DEFAULT_SITE_STATUS_TIMEOUT_MS
  } = {}) {
    this.cacheTtlMs = cacheTtlMs;
    this.getEnvironment = getEnvironment;
    this.getFetch = getFetch;
    this.getTurnMetadata = getTurnMetadata;
    this.logger = logger;
    this.now = now;
    this.timeoutMs = timeoutMs;
  }
  async throwIfBlocksUrl(targetUrl, browserBackend, {
    createBlockedError,
    displayName = "Chrome"
  } = {}) {
    if (typeof targetUrl !== "string")
      return;
    const configuration = resolveSiteStatusConfiguration(this.getEnvironment?.() ?? {});
    if (!configuration.enabled)
      return;
    const turnMetadata = this.getTurnMetadata?.();
    const request = buildSiteStatusRequest(targetUrl, {
      baseUrl: configuration.baseUrl,
      conversationId: turnMetadata?.session_id,
      turnId: turnMetadata?.turn_id,
      urlRequestSource: browserBackend == null ? DEFAULT_URL_REQUEST_SOURCE : `${DEFAULT_URL_REQUEST_SOURCE}:${browserBackend}`
    });
    if (request == null)
      return;
    let blocked;
    try {
      blocked = await this.isBlocked(request);
    } catch (error) {
      this.logFailOpen(error, request.diagnostic);
      return;
    }
    if (!blocked)
      return;
    const reason = `${displayName} is not permitted on ${request.displayUrl}.`;
    throw typeof createBlockedError === "function" ? createBlockedError(reason) : new Error(reason);
  }
  async isBlocked(request) {
    const cached = this.cache.get(request.cacheKey);
    if (cached != null && this.now() - cached.timestampMs < this.cacheTtlMs)
      return cached.blocked;
    if (cached != null)
      this.cache.delete(request.cacheKey);
    const inflight = this.inflightRequests.get(request.cacheKey);
    if (inflight != null)
      return await inflight;
    const pending = this.fetchBlocked(request).then((blocked) => {
      this.cache.set(request.cacheKey, { blocked, timestampMs: this.now() });
      return blocked;
    }).finally(() => {
      if (this.inflightRequests.get(request.cacheKey) === pending) {
        this.inflightRequests.delete(request.cacheKey);
      }
    });
    this.inflightRequests.set(request.cacheKey, pending);
    return await pending;
  }
  async fetchBlocked(request) {
    const fetcher = this.getFetch?.();
    if (typeof fetcher !== "function") {
      throw new SiteStatusProtocolError("fetch_unavailable", "Site status fetch is unavailable.");
    }
    const response = await fetchWithTimeout(fetcher, request.endpoint, this.timeoutMs);
    if (response?.ok !== true) {
      const error = new SiteStatusProtocolError("http_error", "Site status service returned a non-success status.");
      error.status = response?.status;
      throw error;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new SiteStatusProtocolError("invalid_json", "Site status service returned invalid JSON.");
    }
    return parseSiteStatusResponse(payload).blocked;
  }
  logFailOpen(error, diagnostic) {
    const event = {
      event: "browser_use_site_status_fail_open",
      failureType: errorCode(error),
      ...diagnostic
    };
    try {
      this.logger?.(event);
    } catch {}
  }
}
export {
  resolveSiteStatusConfiguration,
  parseSiteStatusResponse,
  buildSiteStatusRequest,
  SiteStatusPolicy,
  SiteStatusConfigurationError,
  SITE_STATUS_CHECK_ENABLED_ENV,
  SITE_STATUS_CACHE_TTL_MS,
  SITE_STATUS_BASE_URL_ENV,
  DEFAULT_SITE_STATUS_TIMEOUT_MS,
  DEFAULT_SITE_STATUS_BASE_URL
};
