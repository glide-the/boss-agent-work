import { BROWSER_CLIENT_SECURITY_POLICY } from "./policy-config.ts";

type UnknownRecord = Record<string, unknown>;

export type FileTransferKind = "download" | "upload";
export type PersistenceScope = "conversation" | "global";

export type ConsentResource =
  | { kind: "origin"; origin: string }
  | { kind: "fileTransfer"; origin: string; transferKind: FileTransferKind }
  | { kind: "fullCdp"; origin: string }
  | { kind: "sensitiveData"; sensitiveData: "browsing_history" };

export interface ConsentDecision {
  decision: "approve" | "deny";
  scope: "turn" | PersistenceScope;
  source:
    | "browser-use-persisted-state"
    | "browser-use-runtime-policy"
    | "codex-network-policy"
    | "guardian-origin-cache";
}

export interface ElicitationResponse {
  action?: string;
  meta?: unknown;
  _meta?: unknown;
  content?: unknown;
}

export interface ElicitationRequest {
  message: string;
  meta: UnknownRecord;
}

export type ElicitationProvider = (
  request: ElicitationRequest,
) => Promise<ElicitationResponse>;

export interface ConfigStore {
  readRequirements(): Promise<unknown>;
  read(options: { cwd: string | null; includeLayers: false }): Promise<unknown>;
  readToml(path: string): Promise<unknown>;
  writeToml(path: string, contents: UnknownRecord): Promise<void>;
}

export interface PrivilegedNodeRepl {
  config: ConfigStore;
  cwd?: string | null;
}

export interface NodeReplState extends Partial<PrivilegedNodeRepl> {
  requestMeta?: UnknownRecord;
}

export interface OriginSessionPolicyDependencies {
  formatSecurityError(message: string): string;
  getElicitationProvider(): ElicitationProvider | null | undefined;
  globalConfigPath: string;
  getNodeRepl(): NodeReplState | undefined;
  getDefaultPrivilegedNodeRepl(): PrivilegedNodeRepl | undefined;
  now?: () => number;
}

export function parseBrowserUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function httpOriginFromUrl(url: URL | null): string | null {
  return url == null || (url.protocol !== "http:" && url.protocol !== "https:")
    ? null
    : url.origin;
}

export function fileUrlWithoutSearchAndHash(url: URL): string {
  url.search = "";
  url.hash = "";
  return url.href;
}

export function extractBrowserOrigin(value: unknown): string | null {
  const url = parseBrowserUrl(value);
  return url == null
    ? null
    : url.protocol === "file:"
      ? fileUrlWithoutSearchAndHash(url)
      : httpOriginFromUrl(url);
}

export function extractHttpOrigin(value: unknown): string | null {
  return httpOriginFromUrl(parseBrowserUrl(value));
}

export function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1"
  );
}

interface TurnMetadata extends UnknownRecord {
  session_id?: unknown;
  thread_id?: unknown;
  thread_source?: unknown;
  turn_id?: unknown;
}

interface TurnIdentity {
  sessionId: string;
  turnId: string;
}

interface ConsentQuery {
  conversationId: string | undefined;
  resource: ConsentResource;
  turn: TurnIdentity | undefined;
}

interface NetworkPolicy {
  enabled: boolean | null;
  allowedDomains: string[];
  deniedDomains: string[];
  hardDenyAllowlistMisses: boolean;
}

interface MatchTarget {
  raw: string;
  hostPort: string | null;
}

interface GuardianCacheEntry {
  expiresAt: number;
  origin: string;
  turnId: string;
}

const APPROVAL_MODE = "approval_mode";
const HISTORY_APPROVAL_MODE = "history_approval_mode";
const NEVER_ASK = "never_ask";
const DISABLE_AUTO_REVIEW = "disable_auto_review";
const ORIGINS = "origins";
const FULL_CDP = "full_cdp";
const DOWNLOADS = "downloads";
const UPLOADS = "uploads";
const ALLOWED = "allowed";
const DENIED = "denied";
const DOWNLOAD_APPROVAL_MODE = "download_approval_mode";
const UPLOAD_APPROVAL_MODE = "upload_approval_mode";
const BROWSING_HISTORY = "browsing_history" as const;
const APPROVALS_REVIEWER = "approvals_reviewer";
const GUARDIAN_SUBAGENT = "guardian_subagent";
const AUTO_REVIEW = "auto_review";
const GUARDIAN_CACHE_TTL_MS = 300_000;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function booleanProperty(
  source: UnknownRecord,
  ...names: string[]
): boolean | undefined {
  for (const name of names) {
    if (typeof source[name] === "boolean") return source[name];
  }
  return undefined;
}

function stringProperty(
  source: UnknownRecord,
  ...names: string[]
): string | null {
  for (const name of names) {
    if (typeof source[name] === "string") return source[name].trim() || null;
  }
  return null;
}

function stringArrayProperty(
  source: UnknownRecord,
  ...names: string[]
): string[] {
  for (const name of names) {
    const value = source[name];
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
  }
  return [];
}

function appendUnique(target: string[], additions: string[]): void {
  for (const addition of additions) {
    if (!target.some((item) => item.toLowerCase() === addition.toLowerCase())) {
      target.push(addition);
    }
  }
}

function networkDomains(source: UnknownRecord): [string[], string[]] {
  const domains = record(source.domains);
  if (domains != null) {
    const allowed: string[] = [];
    const denied: string[] = [];
    for (const [domain, decision] of Object.entries(domains)) {
      if (decision === "allow") allowed.push(domain);
      else if (decision === "deny") denied.push(domain);
    }
    return [allowed, denied];
  }
  return [
    stringArrayProperty(source, "allowedDomains", "allowed_domains"),
    stringArrayProperty(source, "deniedDomains", "denied_domains"),
  ];
}

function mergeNetworkLayer(target: NetworkPolicy, source: UnknownRecord): void {
  const enabled = booleanProperty(source, "enabled");
  if (enabled != null && (!enabled || target.enabled == null))
    target.enabled = enabled;
  const [allowed, denied] = networkDomains(source);
  appendUnique(target.allowedDomains, allowed);
  appendUnique(target.deniedDomains, denied);
}

function mergeOnlyNetworkDenials(
  target: NetworkPolicy,
  source: UnknownRecord,
): void {
  const [, denied] = networkDomains(source);
  appendUnique(target.deniedDomains, denied);
}

export function mergeCodexNetworkPolicy(
  requirements: unknown,
  config: unknown,
): NetworkPolicy {
  const requirementsRecord = record(requirements);
  const configRecord = record(config);
  if (requirementsRecord == null || configRecord == null) {
    throw new TypeError("Codex network policy layers must be objects.");
  }
  const merged: NetworkPolicy = {
    enabled: null,
    allowedDomains: [],
    deniedDomains: [],
    hardDenyAllowlistMisses: false,
  };
  const requirementsNetwork = record(requirementsRecord.requirements)?.network;
  const managedNetwork = record(requirementsNetwork);
  if (managedNetwork != null) {
    mergeNetworkLayer(merged, managedNetwork);
    merged.hardDenyAllowlistMisses =
      booleanProperty(
        managedNetwork,
        "managedAllowedDomainsOnly",
        "managed_allowed_domains_only",
      ) ?? false;
  }

  const configRoot = record(configRecord?.config) ?? configRecord;
  if (configRoot == null) return merged;
  const defaultPermissions = stringProperty(
    configRoot,
    "default_permissions",
    "defaultPermissions",
  );
  const localNetwork =
    defaultPermissions == null
      ? null
      : record(
          record(record(configRoot.permissions)?.[defaultPermissions])?.network,
        );
  if (localNetwork == null) return merged;

  if (merged.hardDenyAllowlistMisses) {
    if (booleanProperty(localNetwork, "enabled") === false)
      merged.enabled = false;
    mergeOnlyNetworkDenials(merged, localNetwork);
  } else {
    mergeNetworkLayer(merged, localNetwork);
  }
  return merged;
}

function normalizedHostname(value: string): string {
  return value.toLowerCase().replace(/\.+$/u, "");
}

function hostnameWithoutPort(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const bracket = trimmed.indexOf("]");
    if (bracket !== -1) return normalizedHostname(trimmed.slice(1, bracket));
  }
  return (trimmed.match(/:/g) ?? []).length === 1
    ? normalizedHostname(trimmed.split(":")[0] ?? "")
    : normalizedHostname(trimmed);
}

function normalizedDomainPattern(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "*") return "*";
  if (trimmed.startsWith("**.")) {
    return `**.${hostnameWithoutPort(trimmed.slice(3))}`;
  }
  if (trimmed.startsWith("*.")) {
    return `*.${hostnameWithoutPort(trimmed.slice(2))}`;
  }
  return hostnameWithoutPort(trimmed);
}

function domainPatternMatches(pattern: string, hostname: string): boolean {
  const normalizedPattern = normalizedDomainPattern(pattern);
  const normalizedHost = hostnameWithoutPort(hostname);
  if (normalizedPattern.length === 0 || normalizedHost.length === 0)
    return false;
  if (normalizedPattern === "*") return true;
  if (normalizedPattern.startsWith("**.")) {
    const suffix = normalizedPattern.slice(3);
    return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
  }
  const regularExpression = `^${normalizedPattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")}$`;
  return new RegExp(regularExpression, "u").test(normalizedHost);
}

function networkPolicyHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? hostnameWithoutPort(parsed.host)
      : null;
  } catch {
    return null;
  }
}

export function evaluateMergedNetworkPolicy(
  policy: NetworkPolicy,
  url: string,
): "deny" | null {
  const hostname = networkPolicyHostname(url);
  if (hostname == null) return null;
  if (
    policy.enabled === false ||
    policy.deniedDomains.some((pattern) =>
      domainPatternMatches(pattern, hostname),
    )
  ) {
    return "deny";
  }
  if (
    policy.hardDenyAllowlistMisses &&
    !policy.allowedDomains.some((pattern) =>
      domainPatternMatches(pattern, hostname),
    )
  ) {
    return "deny";
  }
  return null;
}

function approvalTableName(resource: ConsentResource): string | null {
  switch (resource.kind) {
    case "origin":
      return ORIGINS;
    case "fileTransfer":
      return resource.transferKind === "download" ? DOWNLOADS : UPLOADS;
    case "fullCdp":
      return FULL_CDP;
    case "sensitiveData":
      return null;
  }
}

function resourceValue(resource: ConsentResource): string {
  switch (resource.kind) {
    case "origin":
    case "fileTransfer":
    case "fullCdp":
      return resource.origin;
    case "sensitiveData":
      return resource.sensitiveData;
  }
}

function approvalMode(
  config: UnknownRecord,
  resource: ConsentResource,
): "always_ask" | "never_ask" {
  let propertyName: string;
  switch (resource.kind) {
    case "origin":
      propertyName = APPROVAL_MODE;
      break;
    case "fileTransfer":
      propertyName =
        resource.transferKind === "download"
          ? DOWNLOAD_APPROVAL_MODE
          : UPLOAD_APPROVAL_MODE;
      break;
    case "fullCdp":
      return "always_ask";
    case "sensitiveData":
      propertyName = HISTORY_APPROVAL_MODE;
      break;
  }
  return config[propertyName] === NEVER_ASK ? "never_ask" : "always_ask";
}

function validConversationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

function conversationConfigPath(conversationId: unknown): string | null {
  return validConversationId(conversationId)
    ? `browser/sessions/${conversationId}.toml`
    : null;
}

function wildcardParts(pattern: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      parts.push(current);
      current = "";
      continue;
    }
    if (character === "\\") {
      const next = pattern[index + 1];
      if (next === "*" || next === "\\") {
        current += next;
        index += 1;
        continue;
      }
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

function wildcardMatches(pattern: string, value: string): boolean {
  const parts = wildcardParts(pattern);
  if (parts.length === 1) return parts[0] === value;
  const first = parts[0] ?? "";
  let remaining = value;
  if (first.length > 0) {
    if (!remaining.startsWith(first)) return false;
    remaining = remaining.slice(first.length);
  }
  for (const part of parts.slice(1, -1)) {
    if (part.length === 0) continue;
    const matchIndex = remaining.indexOf(part);
    if (matchIndex === -1) return false;
    remaining = remaining.slice(matchIndex + part.length);
  }
  const last = parts.at(-1) ?? "";
  return last.length === 0 || remaining.endsWith(last);
}

function originHostPort(origin: string): string | null {
  const schemeEnd = origin.indexOf("://");
  if (schemeEnd === -1) return null;
  const scheme = origin.slice(0, schemeEnd).toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  const remainder = origin.slice(schemeEnd + 3);
  const pathStart = remainder.search(/[/?#]/u);
  const authority =
    pathStart === -1 ? remainder : remainder.slice(0, pathStart);
  const hostPort = authority.split("@").at(-1)?.trim() ?? "";
  return hostPort.length > 0 ? hostPort : null;
}

function matchTarget(resource: ConsentResource): MatchTarget {
  const raw = resourceValue(resource);
  const hostPort =
    resource.kind === "sensitiveData" ? null : originHostPort(resource.origin);
  return {
    raw,
    hostPort: hostPort != null && hostPort !== raw ? hostPort : null,
  };
}

function persistedPatternMatches(
  pattern: string,
  target: MatchTarget,
): boolean {
  if (pattern.includes("://")) return wildcardMatches(pattern, target.raw);
  if (target.hostPort != null) return wildcardMatches(pattern, target.hostPort);
  return !target.raw.includes("://") && wildcardMatches(pattern, target.raw);
}

function tableContains(
  table: UnknownRecord,
  listName: string,
  target: MatchTarget,
): boolean {
  const values = table[listName];
  return Array.isArray(values)
    ? values.some(
        (value) =>
          typeof value === "string" &&
          persistedPatternMatches(value.trim(), target),
      )
    : false;
}

function existingTable(
  config: UnknownRecord,
  tableName: string | null,
): UnknownRecord | null {
  if (tableName == null) return null;
  return record(config[tableName]);
}

function writableTable(
  config: UnknownRecord,
  tableName: string,
): UnknownRecord {
  const value = config[tableName];
  if (value == null) {
    const created: UnknownRecord = {};
    config[tableName] = created;
    return created;
  }
  const table = record(value);
  if (table == null)
    throw new Error(`browser-use table ${tableName} must be an object`);
  return table;
}

function addStringValue(
  table: UnknownRecord,
  listName: string,
  value: string,
): void {
  const current = table[listName];
  if (current == null) {
    table[listName] = [value];
    return;
  }
  if (!Array.isArray(current)) {
    throw new Error(`browser-use table key ${listName} must be an array`);
  }
  const strings = current.filter(
    (item): item is string => typeof item === "string",
  );
  if (!strings.includes(value)) strings.push(value);
  table[listName] = strings;
}

function removeStringValue(
  table: UnknownRecord,
  listName: string,
  value: string,
): void {
  const current = table[listName];
  if (Array.isArray(current))
    table[listName] = current.filter((item) => item !== value);
}

function escapedLiteralPattern(value: string): string {
  let escaped = "";
  for (const character of value) {
    if (character === "*") escaped += "\\*";
    else if (character === "\\") escaped += "\\\\";
    else escaped += character;
  }
  return escaped;
}

function responsePersistenceScope(
  response: ElicitationResponse,
): PersistenceScope | null {
  for (const container of [response.meta, response._meta, response.content]) {
    const persist = record(container)?.persist;
    if (persist === "session") return "conversation";
    if (persist === "always") return "global";
  }
  return null;
}

function reviewerIsGuardian(response: ElicitationResponse): boolean {
  const meta = record(response.meta);
  const alternateMeta = record(response._meta);
  const reviewer =
    meta?.[APPROVALS_REVIEWER] ?? alternateMeta?.[APPROVALS_REVIEWER];
  return reviewer === GUARDIAN_SUBAGENT || reviewer === AUTO_REVIEW;
}

async function readTomlConfig(
  client: PrivilegedNodeRepl | undefined,
  path: string,
): Promise<UnknownRecord> {
  if (client == null) return {};
  return record(await client.config.readToml(path)) ?? {};
}

export function createOriginSessionPolicy(
  dependencies: OriginSessionPolicyDependencies,
) {
  const now = dependencies.now ?? Date.now;
  const guardianOriginCache = new Map<string, GuardianCacheEntry>();

  function getTurnMetadata(): TurnMetadata | undefined {
    return (
      (record(
        dependencies.getNodeRepl()?.requestMeta?.["x-codex-turn-metadata"],
      ) as TurnMetadata | null) ?? undefined
    );
  }

  function getCodexSessionId(
    metadata: TurnMetadata | undefined = getTurnMetadata(),
  ): string | undefined {
    if (
      metadata?.thread_source === "subagent" &&
      typeof metadata.thread_id === "string"
    ) {
      return metadata.thread_id;
    }
    return typeof metadata?.session_id === "string"
      ? metadata.session_id
      : undefined;
  }

  function missingRequiredTurnMetadata(): string[] {
    const metadata = getTurnMetadata();
    return ["session_id", "turn_id"].filter(
      (propertyName) => typeof metadata?.[propertyName] !== "string",
    );
  }

  function assertRequiredTurnMetadata(): void {
    const missing = missingRequiredTurnMetadata();
    if (missing.length !== 0) {
      throw new Error(
        `Missing required Codex turn metadata: ${missing.join(", ")}`,
      );
    }
  }

  function formatBrowserName(promptOptions: unknown): string {
    const displayName = record(promptOptions)?.elicitationDisplayName;
    return typeof displayName === "string" ? displayName : "Browser use";
  }

  function resolvePrivilegedNodeRepl(
    promptOptions: unknown,
  ): PrivilegedNodeRepl | undefined {
    const explicitlyProvided = record(promptOptions)?.privilegedNodeRepl;
    return (explicitlyProvided ??
      dependencies.getDefaultPrivilegedNodeRepl()) as
      PrivilegedNodeRepl | undefined;
  }

  async function evaluateCodexNetworkPolicy(
    url: string,
    client:
      | PrivilegedNodeRepl
      | undefined = dependencies.getDefaultPrivilegedNodeRepl(),
  ): Promise<"deny" | null> {
    if (client == null) return null;
    try {
      const [requirements, config] = await Promise.all([
        client.config.readRequirements(),
        client.config.read({
          cwd: client.cwd ?? dependencies.getNodeRepl()?.cwd ?? null,
          includeLayers: false,
        }),
      ]);
      return evaluateMergedNetworkPolicy(
        mergeCodexNetworkPolicy(requirements, config),
        url,
      );
    } catch {
      return "deny";
    }
  }

  function fallbackConversationId(): string | undefined {
    const requestMeta = dependencies.getNodeRepl()?.requestMeta;
    if (requestMeta != null) {
      for (const key of [
        "conversation_id",
        "conversationId",
        "thread_id",
        "threadId",
        "session_id",
        "sessionId",
      ]) {
        const value = requestMeta[key];
        if (typeof value === "string" && value.trim().length > 0) return value;
      }
    }
    return undefined;
  }

  function fallbackTurnIdentity(): TurnIdentity | undefined {
    const requestMeta = dependencies.getNodeRepl()?.requestMeta;
    if (requestMeta == null) return undefined;
    let sessionId: string | undefined;
    for (const key of ["conversation_id", "thread_id", "session_id"]) {
      const value = requestMeta[key];
      if (typeof value === "string" && value.trim().length > 0) {
        sessionId = value;
        break;
      }
    }
    let turnId: string | undefined;
    for (const key of ["turn_id", "turnId"]) {
      const value = requestMeta[key];
      if (typeof value === "string" && value.trim().length > 0) {
        turnId = value;
        break;
      }
    }
    return sessionId == null || turnId == null
      ? undefined
      : { sessionId, turnId };
  }

  function currentConversationId(): string | undefined {
    return getCodexSessionId(getTurnMetadata()) ?? fallbackConversationId();
  }

  function currentTurn(): TurnIdentity | undefined {
    const metadata = getTurnMetadata();
    const sessionId = getCodexSessionId(metadata);
    return sessionId != null && typeof metadata?.turn_id === "string"
      ? { sessionId, turnId: metadata.turn_id }
      : fallbackTurnIdentity();
  }

  function consentQuery(resource: ConsentResource): ConsentQuery {
    return {
      conversationId: currentConversationId(),
      resource,
      turn: currentTurn(),
    };
  }

  function reconcileGuardianCache(query: ConsentQuery): void {
    const turn = query.turn;
    if (turn == null || query.resource.kind !== "origin") return;
    const cached = guardianOriginCache.get(turn.sessionId);
    if (cached == null) return;
    if (cached.expiresAt <= now()) {
      guardianOriginCache.delete(turn.sessionId);
      return;
    }
    if (
      cached.turnId !== turn.turnId ||
      cached.origin !== query.resource.origin
    ) {
      guardianOriginCache.delete(turn.sessionId);
    }
  }

  function guardianCacheApproves(query: ConsentQuery): boolean {
    const turn = query.turn;
    if (turn == null || query.resource.kind !== "origin") return false;
    const cached = guardianOriginCache.get(turn.sessionId);
    if (cached == null) return false;
    if (cached.expiresAt <= now()) {
      guardianOriginCache.delete(turn.sessionId);
      return false;
    }
    return (
      cached.turnId === turn.turnId && cached.origin === query.resource.origin
    );
  }

  function cacheGuardianOriginApproval(query: ConsentQuery): void {
    const turn = query.turn;
    if (turn == null || query.resource.kind !== "origin") return;
    guardianOriginCache.set(turn.sessionId, {
      expiresAt: now() + GUARDIAN_CACHE_TTL_MS,
      origin: query.resource.origin,
      turnId: turn.turnId,
    });
  }

  async function sessionConfig(
    client: PrivilegedNodeRepl | undefined,
    conversationId: string | undefined,
  ): Promise<UnknownRecord> {
    const path = conversationConfigPath(conversationId);
    return path == null ? {} : readTomlConfig(client, path);
  }

  async function queryDecision(
    query: ConsentQuery,
    client: PrivilegedNodeRepl | undefined,
  ): Promise<ConsentDecision | null> {
    const networkDecision =
      query.resource.kind === "origin"
        ? await evaluateCodexNetworkPolicy(query.resource.origin, client)
        : null;
    try {
      const globalConfig = await readTomlConfig(
        client,
        dependencies.globalConfigPath,
      );
      const tableName = approvalTableName(query.resource);
      const conversationConfig =
        tableName == null
          ? {}
          : await sessionConfig(client, query.conversationId);
      const globalTable = existingTable(globalConfig, tableName);
      const conversationTable = existingTable(conversationConfig, tableName);
      const target = matchTarget(query.resource);
      reconcileGuardianCache(query);

      if (
        conversationTable != null &&
        tableContains(conversationTable, DENIED, target)
      ) {
        return {
          decision: "deny",
          scope: "conversation",
          source: "browser-use-persisted-state",
        };
      }
      if (globalTable != null && tableContains(globalTable, DENIED, target)) {
        return {
          decision: "deny",
          scope: "global",
          source: "browser-use-persisted-state",
        };
      }
      if (networkDecision === "deny") {
        return {
          decision: "deny",
          scope: "global",
          source: "codex-network-policy",
        };
      }
      if (guardianCacheApproves(query)) {
        return {
          decision: "approve",
          scope: "turn",
          source: "guardian-origin-cache",
        };
      }
      if (
        conversationTable != null &&
        tableContains(conversationTable, ALLOWED, target)
      ) {
        return {
          decision: "approve",
          scope: "conversation",
          source: "browser-use-persisted-state",
        };
      }
      if (globalTable != null && tableContains(globalTable, ALLOWED, target)) {
        return {
          decision: "approve",
          scope: "global",
          source: "browser-use-persisted-state",
        };
      }
      return approvalMode(globalConfig, query.resource) === NEVER_ASK
        ? {
            decision: "approve",
            scope: "global",
            source: "browser-use-persisted-state",
          }
        : null;
    } catch {
      return null;
    }
  }

  async function queryOrigin(
    origin: string,
    promptOptions?: unknown,
  ): Promise<ConsentDecision | null> {
    const client = resolvePrivilegedNodeRepl(promptOptions);
    if (BROWSER_CLIENT_SECURITY_POLICY.originAuthorization === "disabled") {
      return client == null ||
        (await evaluateCodexNetworkPolicy(origin, client)) === "deny"
        ? { decision: "deny", scope: "global", source: "codex-network-policy" }
        : {
            decision: "approve",
            scope: "global",
            source: "browser-use-runtime-policy",
          };
    }
    return queryDecision(consentQuery({ kind: "origin", origin }), client);
  }

  async function queryFileTransfer(
    transferKind: FileTransferKind,
    origin: string,
    promptOptions?: unknown,
  ): Promise<ConsentDecision | null> {
    return queryDecision(
      consentQuery({ kind: "fileTransfer", origin, transferKind }),
      resolvePrivilegedNodeRepl(promptOptions),
    );
  }

  async function queryFullCdp(
    origin: string,
    promptOptions?: unknown,
  ): Promise<ConsentDecision | null> {
    const originDecision = await queryOrigin(origin, promptOptions);
    return originDecision?.decision === "deny"
      ? originDecision
      : queryDecision(
          consentQuery({ kind: "fullCdp", origin }),
          resolvePrivilegedNodeRepl(promptOptions),
        );
  }

  async function queryHistory(
    promptOptions?: unknown,
  ): Promise<ConsentDecision | null> {
    return queryDecision(
      consentQuery({ kind: "sensitiveData", sensitiveData: BROWSING_HISTORY }),
      resolvePrivilegedNodeRepl(promptOptions),
    );
  }

  async function isAutomaticReviewDisabled(
    promptOptions?: unknown,
  ): Promise<boolean> {
    try {
      return (
        (
          await readTomlConfig(
            resolvePrivilegedNodeRepl(promptOptions),
            dependencies.globalConfigPath,
          )
        )[DISABLE_AUTO_REVIEW] === true
      );
    } catch {
      return false;
    }
  }

  function persistencePath(
    scope: PersistenceScope,
    conversationId: string | undefined,
  ): string | null {
    return scope === "global"
      ? dependencies.globalConfigPath
      : conversationConfigPath(conversationId);
  }

  async function writeDecision(
    client: PrivilegedNodeRepl,
    query: ConsentQuery,
    scope: PersistenceScope,
    decision: "approve" | "deny",
  ): Promise<void> {
    const path = persistencePath(scope, query.conversationId);
    if (path == null) return;
    const config = await readTomlConfig(client, path);
    const tableName = approvalTableName(query.resource);
    if (tableName == null) return;
    const table = writableTable(config, tableName);
    const [destination, opposite] =
      decision === "approve" ? [ALLOWED, DENIED] : [DENIED, ALLOWED];
    const raw = resourceValue(query.resource);
    const escaped = escapedLiteralPattern(raw);
    removeStringValue(table, opposite, raw);
    if (escaped !== raw) removeStringValue(table, opposite, escaped);
    addStringValue(table, destination, escaped);
    await client.config.writeToml(path, config);
  }

  async function persistResponse(
    query: ConsentQuery,
    allowGuardianCache: boolean,
    response: ElicitationResponse,
    client: PrivilegedNodeRepl | undefined,
  ): Promise<void> {
    try {
      if (allowGuardianCache && reviewerIsGuardian(response)) {
        if (response.action === "accept") cacheGuardianOriginApproval(query);
        return;
      }
      if (client == null) return;
      const decision =
        response.action === "accept"
          ? "approve"
          : response.action === "decline"
            ? "deny"
            : null;
      if (decision == null || approvalTableName(query.resource) == null) return;
      const scope =
        responsePersistenceScope(response) ??
        (query.resource.kind === "origin" || query.resource.kind === "fullCdp"
          ? "conversation"
          : null);
      if (scope != null) await writeDecision(client, query, scope, decision);
    } catch {
      // Consent persistence is best effort; the immediate elicitation result remains authoritative.
    }
  }

  async function persistOriginResponse(
    origin: string,
    response: ElicitationResponse,
    promptOptions?: unknown,
  ): Promise<void> {
    if (BROWSER_CLIENT_SECURITY_POLICY.originAuthorization === "disabled")
      return;
    await persistResponse(
      consentQuery({ kind: "origin", origin }),
      true,
      response,
      resolvePrivilegedNodeRepl(promptOptions),
    );
  }

  async function persistFileTransferResponse(
    transferKind: FileTransferKind,
    origin: string,
    response: ElicitationResponse,
    promptOptions?: unknown,
  ): Promise<void> {
    await persistResponse(
      consentQuery({ kind: "fileTransfer", origin, transferKind }),
      false,
      response,
      resolvePrivilegedNodeRepl(promptOptions),
    );
  }

  async function persistFullCdpResponse(
    origin: string,
    response: ElicitationResponse,
    promptOptions?: unknown,
  ): Promise<void> {
    await persistResponse(
      consentQuery({ kind: "fullCdp", origin }),
      false,
      response,
      resolvePrivilegedNodeRepl(promptOptions),
    );
  }

  async function persistHistoryResponse(
    response: ElicitationResponse,
    promptOptions?: unknown,
  ): Promise<void> {
    const client = resolvePrivilegedNodeRepl(promptOptions);
    if (
      response.action !== "accept" ||
      responsePersistenceScope(response) !== "global" ||
      client == null
    ) {
      return;
    }
    try {
      const config = await readTomlConfig(
        client,
        dependencies.globalConfigPath,
      );
      config[HISTORY_APPROVAL_MODE] = NEVER_ASK;
      await client.config.writeToml(dependencies.globalConfigPath, config);
    } catch {
      // History persistence is also best effort.
    }
  }

  async function requestOriginConsent(
    origin: string,
    promptOptions?: unknown,
  ): Promise<void> {
    const browserName = formatBrowserName(promptOptions);
    const existingDecision = await queryOrigin(origin, promptOptions);
    if (existingDecision?.decision === "approve") return;
    if (existingDecision?.decision === "deny") {
      const reason =
        existingDecision.source === "codex-network-policy"
          ? `${browserName} cannot access ${origin} because enterprise network policy blocks it.`
          : `The user has requested that ${origin} should not be used.`;
      throw new Error(dependencies.formatSecurityError(reason));
    }

    const elicitation = dependencies.getElicitationProvider();
    if (elicitation == null) {
      throw new Error(
        dependencies.formatSecurityError(
          `${browserName} encountered an error attempting to request permission to access ${origin}. Please use another source or try another approach.`,
        ),
      );
    }
    const automaticReviewDisabled =
      await isAutomaticReviewDisabled(promptOptions);
    const response = await elicitation({
      message: `Allow ${browserName} to access ${origin}?`,
      meta: {
        codex_approval_kind: "mcp_tool_call",
        ...(automaticReviewDisabled
          ? {}
          : { codex_request_type: "approval_request" }),
        connector_id: "browser-use",
        connector_name: browserName,
        persist: "always",
        tool_name: "access_browser_origin",
        tool_title: "Access browser origin",
        tool_params: { origin },
        tool_params_display: [],
        origin,
      },
    });
    await persistOriginResponse(origin, response, promptOptions);
    if (response.action !== "accept") {
      throw new Error(
        dependencies.formatSecurityError(
          `The user has requested that ${origin} should not be used.`,
        ),
      );
    }
  }

  async function requestBrowserHistoryConsent(
    parameters: unknown,
    promptOptions?: unknown,
  ): Promise<void> {
    const browserName = formatBrowserName(promptOptions);
    if ((await queryHistory(promptOptions))?.decision === "approve") return;
    const elicitation = dependencies.getElicitationProvider();
    if (elicitation == null) {
      throw new Error(
        `${browserName} encountered an error attempting to request permission to read browsing history. Please use another source or try another approach.`,
      );
    }
    const response = await elicitation({
      message: `Allow ${browserName} to read your browsing history?`,
      meta: {
        codex_approval_kind: "mcp_tool_call",
        connector_id: "browser-use",
        connector_name: browserName,
        persist: "always",
        tool_params: parameters,
        sensitive_data: BROWSING_HISTORY,
      },
    });
    await persistHistoryResponse(response, promptOptions);
    if (response.action !== "accept") {
      throw new Error(
        "The user has requested that browsing history not be read.",
      );
    }
  }

  return {
    assertRequiredTurnMetadata,
    evaluateCodexNetworkPolicy,
    extractBrowserOrigin,
    extractHttpOrigin,
    fileUrlWithoutSearchAndHash,
    formatBrowserName,
    getCodexSessionId,
    getTurnMetadata,
    isAutomaticReviewDisabled,
    isLocalhostHostname,
    missingRequiredTurnMetadata,
    persistFileTransferResponse,
    persistFullCdpResponse,
    persistHistoryResponse,
    persistOriginResponse,
    parseBrowserUrl,
    queryFileTransfer,
    queryFullCdp,
    queryHistory,
    queryOrigin,
    requestBrowserHistoryConsent,
    requestOriginConsent,
    resolvePrivilegedNodeRepl,
    httpOriginFromUrl,
  };
}
