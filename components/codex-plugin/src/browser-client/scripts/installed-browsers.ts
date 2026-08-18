#!/usr/bin/env node
// Semantic-equivalent TypeScript recovery.
// Evidence source: components/codex-plugin/scripts-bak/installed-browsers.js
// Do not present reconstructed names or types as the author's originals.
/* global console */
/* Report the default browser and known installed internet browsers. */

type NodeFs = typeof import("node:fs");
type NodeOs = typeof import("node:os");
type NodePath = typeof import("node:path");
type ExecFileSync = typeof import("node:child_process").execFileSync;

interface KnownBrowser {
  name: string;
  bundleIds: string[];
  appNames: string[];
  commands: string[];
  windowsExecutable: string;
}

interface BrowserInstallation {
  name: string;
  command?: string;
  bundle_id: string | null;
  path: string;
  version: string | null;
}

interface SchemeHandler {
  scheme: string;
  bundle_id?: string;
  prog_id?: string;
  name: string | null;
  path?: string | null;
  version?: string | null;
}

interface DefaultBrowser {
  source: string;
  schemes?: Record<string, SchemeHandler>;
  desktop_file?: string | null;
  prog_id?: string | null;
  platform?: NodeJS.Platform;
}

interface BrowserInventory {
  platform: NodeJS.Platform;
  default_browser: DefaultBrowser;
  installed_browsers: BrowserInstallation[];
}

interface ParsedArguments {
  check: boolean;
  json: boolean;
}

let fs: NodeFs;
let os: NodeOs;
let path: NodePath;
let process: typeof globalThis.process = globalThis.process;
let execFileSync: ExecFileSync;

const KNOWN_BROWSERS: KnownBrowser[] = [
  {
    name: "Google Chrome",
    bundleIds: ["com.google.Chrome"],
    appNames: ["Google Chrome.app"],
    commands: ["google-chrome", "chrome"],
    windowsExecutable: "chrome.exe",
  },
];

const DEFAULT_BROWSER_SCHEMES = ["http", "https"];

async function loadNodeModules(): Promise<void> {
  fs = await import("node:fs");
  os = await import("node:os");
  path = await import("node:path");
  process = (await import("node:process")).default;
  ({ execFileSync } = await import("node:child_process"));
}

function macosAppSearchDirs(): string[] {
  return [
    "/Applications",
    "/System/Applications",
    path.join(os.homedir(), "Applications"),
  ];
}

function runCommand(args: string[]): string | null {
  const command = args[0];
  if (command == null) return null;
  try {
    return execFileSync(command, args.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readWindowsRegistryValue(
  keyPath: string,
  valueName: string | null,
): string | null {
  const args = ["reg", "query", keyPath, valueName == null ? "/ve" : "/v"];
  if (valueName != null) args.push(valueName);

  const output = runCommand(args);
  if (!output) return null;

  const label = valueName == null ? "(Default)" : valueName;
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(.*?)\s+REG_\w+\s+(.+?)\s*$/);
    const matchedLabel = match?.[1];
    const matchedValue = match?.[2];
    if (matchedLabel === label && matchedValue != null)
      return stripRegistryString(matchedValue);
  }

  return null;
}

function stripRegistryString(value: string): string {
  return value.replace(/^"(.*)"$/, "$1");
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringProperty(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const property = value[key];
  return typeof property === "string" && property !== "" ? property : null;
}

function windowsChromeInstallPaths(): string[] {
  const appPathKeys = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
  ];
  const candidates = appPathKeys
    .map((keyPath) => readWindowsRegistryValue(keyPath, null))
    .filter(isString);

  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const standardRoots = [
    localAppData,
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
  ].filter(isString);

  for (const root of standardRoots) {
    candidates.push(
      path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
    );
  }

  const pathChrome = commandPath("chrome");
  if (pathChrome) candidates.push(pathChrome);

  const found = new Map<string, string>();
  for (const candidate of candidates) {
    const executablePath = path.resolve(candidate);
    if (!fs.existsSync(executablePath)) continue;

    found.set(executablePath.toLowerCase(), executablePath);
  }

  return [...found.values()];
}

function windowsChromeVersion(): string | null {
  const uninstallKeys = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Google Chrome",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Google Chrome",
    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Google Chrome",
  ];

  for (const keyPath of uninstallKeys) {
    const version = readWindowsRegistryValue(keyPath, "DisplayVersion");
    if (version) return version;
  }

  return null;
}

function readPlistKey(plistPath: string, key: string): string | null {
  return runCommand(["plutil", "-extract", key, "raw", "-o", "-", plistPath]);
}

function readPlistJson(plistPath: string): Record<string, unknown> {
  const output = runCommand([
    "plutil",
    "-convert",
    "json",
    "-o",
    "-",
    plistPath,
  ]);
  if (!output) return {};

  try {
    const value: unknown = JSON.parse(output);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function readBundleInfo(appPath: string): Record<string, unknown> {
  const infoPath = path.join(appPath, "Contents", "Info.plist");
  if (!fs.existsSync(infoPath)) return {};

  const info = readPlistJson(infoPath);
  if (Object.keys(info).length > 0) return info;

  return {
    CFBundleIdentifier: readPlistKey(infoPath, "CFBundleIdentifier"),
    CFBundleShortVersionString: readPlistKey(
      infoPath,
      "CFBundleShortVersionString",
    ),
  };
}

function knownBrowserByBundleId(): Map<string, KnownBrowser> {
  const byBundleId = new Map<string, KnownBrowser>();
  for (const browser of KNOWN_BROWSERS)
    for (const bundleId of browser.bundleIds) byBundleId.set(bundleId, browser);

  return byBundleId;
}

function macosAppCandidates(browser: KnownBrowser): string[] {
  const candidates: string[] = [];
  for (const baseDir of macosAppSearchDirs()) {
    for (const appName of browser.appNames)
      candidates.push(path.join(baseDir, appName));
  }
  return candidates;
}

function mdfindAppsForBundleId(bundleId: string): string[] {
  const output = runCommand([
    "mdfind",
    `kMDItemCFBundleIdentifier == '${bundleId}'`,
  ]);
  if (!output) return [];

  return output.split(/\r?\n/).filter((line) => line.endsWith(".app"));
}

function addMacosApp(
  installedByBundleId: Map<string, BrowserInstallation>,
  browser: KnownBrowser,
  appPath: string,
  fallbackBundleId: string | null = null,
): void {
  if (!fs.existsSync(appPath)) return;

  const info = readBundleInfo(appPath);
  const bundleId =
    stringProperty(info, "CFBundleIdentifier") ||
    fallbackBundleId ||
    browser.bundleIds[0];
  if (!bundleId) return;

  installedByBundleId.set(bundleId, {
    name: browser.name,
    bundle_id: bundleId,
    path: appPath,
    version:
      stringProperty(info, "CFBundleShortVersionString") ||
      stringProperty(info, "CFBundleVersion"),
  });
}

function findMacosApps(): BrowserInstallation[] {
  const installedByBundleId = new Map<string, BrowserInstallation>();

  for (const browser of KNOWN_BROWSERS) {
    for (const appPath of macosAppCandidates(browser))
      addMacosApp(installedByBundleId, browser, appPath);

    for (const bundleId of browser.bundleIds) {
      for (const appPath of mdfindAppsForBundleId(bundleId))
        addMacosApp(installedByBundleId, browser, appPath, bundleId);
    }
  }

  const knownByBundleId = knownBrowserByBundleId();
  for (const baseDir of macosAppSearchDirs()) {
    if (!fs.existsSync(baseDir)) continue;

    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;

      const appPath = path.join(baseDir, entry.name);
      const info = readBundleInfo(appPath);
      const bundleId = stringProperty(info, "CFBundleIdentifier");
      const browser = bundleId ? knownByBundleId.get(bundleId) : undefined;
      if (!browser) continue;

      addMacosApp(
        installedByBundleId,
        browser,
        appPath,
        bundleId,
      );
    }
  }

  return [...installedByBundleId.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function resolveMacosAppByBundleId(
  bundleId: string,
): BrowserInstallation | null {
  for (const appPath of mdfindAppsForBundleId(bundleId)) {
    if (!fs.existsSync(appPath)) continue;

    const info = readBundleInfo(appPath);
    const discoveredBundleId = stringProperty(info, "CFBundleIdentifier");
    if (discoveredBundleId && discoveredBundleId !== bundleId)
      continue;

    return {
      name:
        stringProperty(info, "CFBundleName") ||
        stringProperty(info, "CFBundleDisplayName") ||
        path.basename(appPath, ".app"),
      bundle_id: bundleId,
      path: appPath,
      version:
        stringProperty(info, "CFBundleShortVersionString") ||
        stringProperty(info, "CFBundleVersion"),
    };
  }

  return null;
}

function commandPath(command: string): string | null {
  if (process.platform === "win32")
    return runCommand(["where", command])?.split(/\r?\n/)[0] || null;

  return runCommand(["which", command]);
}

function findCommandBrowsers(): BrowserInstallation[] {
  const found = new Map<string, BrowserInstallation>();

  for (const browser of KNOWN_BROWSERS) {
    for (const command of browser.commands) {
      const executable = commandPath(command);
      if (!executable) continue;

      found.set(browser.name, {
        name: browser.name,
        command,
        path: executable,
        bundle_id: browser.bundleIds[0] || null,
        version: null,
      });
      break;
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findWindowsApps(): BrowserInstallation[] {
  const found = new Map<string, BrowserInstallation>();
  const version = windowsChromeVersion();

  for (const browser of KNOWN_BROWSERS) {
    if (!browser.windowsExecutable) continue;

    for (const executablePath of windowsChromeInstallPaths()) {
      if (
        path.basename(executablePath).toLowerCase() !==
        browser.windowsExecutable
      )
        continue;

      found.set(executablePath.toLowerCase(), {
        name: browser.name,
        command: "chrome",
        path: executablePath,
        bundle_id: null,
        version,
      });
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function loadLaunchServicesHandlers(): Array<Record<string, unknown>> {
  const plistPath = path.join(
    os.homedir(),
    "Library",
    "Preferences",
    "com.apple.LaunchServices",
    "com.apple.launchservices.secure.plist",
  );

  if (!fs.existsSync(plistPath)) return [];

  const output = runCommand([
    "plutil",
    "-extract",
    "LSHandlers",
    "json",
    "-o",
    "-",
    plistPath,
  ]);
  if (!output) return [];

  try {
    const handlers: unknown = JSON.parse(output);
    return Array.isArray(handlers) ? handlers.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function findDefaultBrowserMacos(
  installed: BrowserInstallation[],
): DefaultBrowser {
  const byBundleId = new Map(
    installed
      .filter((item) => item.bundle_id)
      .map((item) => [item.bundle_id, item]),
  );
  const knownByBundleId = knownBrowserByBundleId();
  const schemes: Record<string, SchemeHandler> = {};

  for (const handler of loadLaunchServicesHandlers()) {
    const scheme = stringProperty(handler, "LSHandlerURLScheme");
    if (scheme !== "http" && scheme !== "https") continue;

    const bundleId =
      stringProperty(handler, "LSHandlerRoleAll") ||
      stringProperty(handler, "LSHandlerRoleViewer");
    if (!bundleId) continue;

    const installedMatch = byBundleId.get(bundleId);
    const knownMatch = knownByBundleId.get(bundleId);
    const resolvedMatch =
      installedMatch ||
      (knownMatch ? null : resolveMacosAppByBundleId(bundleId));
    schemes[scheme] = {
      scheme,
      bundle_id: bundleId,
      name:
        installedMatch?.name || knownMatch?.name || resolvedMatch?.name || null,
      path: installedMatch?.path || resolvedMatch?.path || null,
      version: installedMatch?.version || resolvedMatch?.version || null,
    };
  }

  return { source: "LaunchServices", schemes };
}

function findDefaultBrowserLinux(): DefaultBrowser {
  return {
    source: "xdg-settings",
    desktop_file: runCommand(["xdg-settings", "get", "default-web-browser"]),
  };
}

function findDefaultBrowserWindows(): DefaultBrowser {
  const schemes: Record<string, SchemeHandler> = {};

  for (const scheme of DEFAULT_BROWSER_SCHEMES) {
    const keyPath = `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}\\UserChoice`;
    const progId = readWindowsRegistryValue(keyPath, "ProgId");
    if (!progId) continue;

    schemes[scheme] = {
      scheme,
      prog_id: progId,
      name: progId.toLowerCase().startsWith("chrome") ? "Google Chrome" : null,
    };
  }

  return { source: "registry", schemes };
}

function collectInventory(): BrowserInventory {
  let installed: BrowserInstallation[];
  let defaultBrowser: DefaultBrowser;

  if (process.platform === "darwin") {
    installed = findMacosApps();
    defaultBrowser = findDefaultBrowserMacos(installed);
  } else if (process.platform === "linux") {
    installed = findCommandBrowsers();
    defaultBrowser = findDefaultBrowserLinux();
  } else if (process.platform === "win32") {
    installed = findWindowsApps();
    defaultBrowser = findDefaultBrowserWindows();
  } else {
    installed = findCommandBrowsers();
    defaultBrowser = { source: "unsupported", platform: process.platform };
  }

  return {
    platform: process.platform,
    default_browser: defaultBrowser,
    installed_browsers: installed,
  };
}

function printTextReport(inventory: BrowserInventory, check: boolean): void {
  if (check) {
    console.log("Chrome plugin setup/configuration check");
    console.log("status: ok");
    console.log("");
  }

  console.log("Default browser");
  const defaultBrowser = inventory.default_browser;
  const schemes = defaultBrowser.schemes;
  if (schemes && Object.keys(schemes).length > 0) {
    for (const scheme of ["http", "https"]) {
      const item = schemes[scheme];
      if (!item) {
        console.log(`  ${scheme}: unknown`);
        continue;
      }
      const name = item.name || "unknown app";
      const identifier = item.bundle_id || item.prog_id || "unknown id";
      console.log(`  ${scheme}: ${name} (${identifier})`);
      if (item.path) console.log(`      path: ${item.path}`);
    }
  } else if (defaultBrowser.desktop_file)
    console.log(`  ${defaultBrowser.desktop_file}`);
  else if (defaultBrowser.prog_id) console.log(`  ${defaultBrowser.prog_id}`);
  else console.log(`  unknown (source: ${defaultBrowser.source || "unknown"})`);

  console.log("");
  console.log("Installed known internet browsers");
  if (inventory.installed_browsers.length === 0) {
    console.log("  none found");
    return;
  }

  for (const item of inventory.installed_browsers) {
    console.log(`  - ${item.name}`);
    if (item.bundle_id) console.log(`      bundle id: ${item.bundle_id}`);

    if (item.version) console.log(`      version: ${item.version}`);

    console.log(`      path: ${item.path}`);
  }
}

function parseArgs(argv: string[]): ParsedArguments {
  const flags = new Set(argv);
  if (flags.has("-h") || flags.has("--help")) {
    console.log("Usage: installed-browsers.js [--check] [--json]");
    process.exit(0);
  }
  return {
    check: flags.has("--check"),
    json: flags.has("--json"),
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const inventory = collectInventory();

  if (args.json) console.log(JSON.stringify(inventory, null, 2));
  else printTextReport(inventory, args.check);

  if (args.check && inventory.installed_browsers.length === 0)
    process.exitCode = 1;
}

void loadNodeModules()
  .then(() => {
    main();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });

export {};
