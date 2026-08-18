#!/usr/bin/env node
// Semantic-equivalent TypeScript recovery.
// Evidence source: components/codex-plugin/scripts-bak/open-chrome-window.js
// Do not present reconstructed names or types as the author's originals.
/* global console */
/* Open a Chrome window for the profile selected by the Chrome plugin checks. */

const CHROME_PREFERENCES_PATH_ENV = "CODEX_CHROME_PREFERENCES_PATH";
const CHROME_USER_DATA_DIR_ENV = "CODEX_CHROME_USER_DATA_DIR";
const MACOS_CHROME_BUNDLE_ID = "com.google.Chrome";
const MACOS_CHROME_APP_NAMES = ["Google Chrome.app"];
const WINDOWS_CHROME_EXECUTABLE = "chrome.exe";
const ABOUT_BLANK_URL = "about:blank";

type NodeFs = typeof import("node:fs");
type NodeOs = typeof import("node:os");
type NodePath = typeof import("node:path");
type ExecFileSync = typeof import("node:child_process").execFileSync;

interface OpenChromeCommand {
  command: string;
  args: string[];
}

interface ParsedArguments {
  dryRun: boolean;
  json: boolean;
}

interface OpenChromeResult extends OpenChromeCommand {
  platform: NodeJS.Platform;
  dryRun: boolean;
  profileDirectory: string;
}

let fs: NodeFs;
let os: NodeOs;
let path: NodePath;
let process: typeof globalThis.process = globalThis.process;
let execFileSync: ExecFileSync;

async function loadNodeModules(): Promise<void> {
  fs = await import("node:fs");
  os = await import("node:os");
  path = await import("node:path");
  process = (await import("node:process")).default;
  ({ execFileSync } = await import("node:child_process"));
}

function usage(): void {
  console.error("Usage: scripts/open-chrome-window.js [--dry-run] [--json]");
  console.error("");
  console.error(
    `Optional profile-root override: ${CHROME_USER_DATA_DIR_ENV}=/tmp/chrome-root`,
  );
  console.error(
    `Optional preferences-file override: ${CHROME_PREFERENCES_PATH_ENV}=/tmp/Profile/Preferences`,
  );
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

function resolveChromeUserDataDirectory(): string {
  if (process.env[CHROME_USER_DATA_DIR_ENV])
    return path.resolve(process.env[CHROME_USER_DATA_DIR_ENV]);

  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Google",
      "Chrome",
    );
  }

  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "Google",
      "Chrome",
      "User Data",
    );
  }

  return path.join(os.homedir(), ".config", "google-chrome");
}

function resolveChromePreferencesPath(): string {
  if (process.env[CHROME_PREFERENCES_PATH_ENV])
    return path.resolve(process.env[CHROME_PREFERENCES_PATH_ENV]);

  const userDataDirectory = resolveChromeUserDataDirectory();
  const profileDirectory = resolveChromeProfileDirectory(userDataDirectory);
  return path.join(userDataDirectory, profileDirectory, "Preferences");
}

function resolveChromeProfileDirectory(userDataDirectory: string): string {
  const localStateProfile =
    resolveChromeProfileDirectoryFromLocalState(userDataDirectory);
  if (localStateProfile) return localStateProfile;

  const latestProfile = findLatestChromeProfile(userDataDirectory);
  if (latestProfile) return latestProfile;

  throw new Error(
    `Could not find a Chrome profile directory with Preferences in ${userDataDirectory}.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveChromeProfileDirectoryFromLocalState(
  userDataDirectory: string,
): string | null {
  const localState = readJsonFileIfPresent(
    path.join(userDataDirectory, "Local State"),
  );
  const profile = isRecord(localState) ? localState.profile : undefined;
  if (!isRecord(profile)) return null;

  if (isUsableChromeProfile(userDataDirectory, profile.last_used))
    return profile.last_used;

  if (Array.isArray(profile.last_active_profiles)) {
    return chooseLatestUsableChromeProfile(
      userDataDirectory,
      profile.last_active_profiles,
    );
  }

  return null;
}

function chooseLatestUsableChromeProfile(
  userDataDirectory: string,
  profileDirectories: unknown[],
): string | null {
  const usableProfiles = profileDirectories.filter((profileDirectory) => {
    return isUsableChromeProfile(userDataDirectory, profileDirectory);
  });
  if (usableProfiles.length === 0) return null;

  return usableProfiles.sort(compareChromeProfileDirectories).at(-1) ?? null;
}

function findLatestChromeProfile(userDataDirectory: string): string | null {
  if (!fs.existsSync(userDataDirectory)) {
    throw new Error(
      `Chrome user data directory does not exist: ${userDataDirectory}`,
    );
  }

  const profileDirectories = fs
    .readdirSync(userDataDirectory, { withFileTypes: true })
    .filter((entry) => {
      return (
        entry.isDirectory() &&
        (entry.name === "Default" || /^Profile \d+$/.test(entry.name))
      );
    })
    .map((entry) => entry.name);

  return chooseLatestUsableChromeProfile(userDataDirectory, profileDirectories);
}

function readJsonFileIfPresent(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return null;

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isUsableChromeProfile(
  userDataDirectory: string,
  profileDirectory: unknown,
): profileDirectory is string {
  if (typeof profileDirectory !== "string" || profileDirectory.length === 0)
    return false;

  return fs.existsSync(
    path.join(userDataDirectory, profileDirectory, "Preferences"),
  );
}

function compareChromeProfileDirectories(first: string, second: string): number {
  return (
    chromeProfileDirectorySortKey(first) -
    chromeProfileDirectorySortKey(second)
  );
}

function chromeProfileDirectorySortKey(profileDirectory: string): number {
  if (profileDirectory === "Default") return 0;

  const match = profileDirectory.match(/^Profile (\d+)$/);
  if (!match) return -1;

  return Number(match[1]);
}

function macosAppSearchDirs(): string[] {
  return [
    "/Applications",
    "/System/Applications",
    path.join(os.homedir(), "Applications"),
  ];
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
  };
}

function macosAppCandidates(): string[] {
  const candidates: string[] = [];
  for (const baseDir of macosAppSearchDirs()) {
    for (const appName of MACOS_CHROME_APP_NAMES)
      candidates.push(path.join(baseDir, appName));
  }
  return candidates;
}

function mdfindChromeApps(): string[] {
  const output = runCommand([
    "mdfind",
    `kMDItemCFBundleIdentifier == '${MACOS_CHROME_BUNDLE_ID}'`,
  ]);
  if (!output) return [];

  return output.split(/\r?\n/).filter((line) => line.endsWith(".app"));
}

function isChromeApp(appPath: string, allowNamedFallback = false): boolean {
  if (!fs.existsSync(appPath)) return false;

  const info = readBundleInfo(appPath);
  if (info.CFBundleIdentifier === MACOS_CHROME_BUNDLE_ID) return true;

  return (
    allowNamedFallback &&
    MACOS_CHROME_APP_NAMES.includes(path.basename(appPath))
  );
}

function findMacosChromeAppPath(): string {
  for (const appPath of macosAppCandidates())
    if (isChromeApp(appPath, true)) return appPath;

  for (const appPath of mdfindChromeApps())
    if (isChromeApp(appPath)) return appPath;

  for (const baseDir of macosAppSearchDirs()) {
    if (!fs.existsSync(baseDir)) continue;

    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;

      const appPath = path.join(baseDir, entry.name);
      if (isChromeApp(appPath)) return appPath;
    }
  }

  throw new Error("Could not find the Google Chrome app.");
}

function commandPath(command: string): string | null {
  if (process.platform === "win32")
    return runCommand(["where", command])?.split(/\r?\n/)[0] || null;

  return runCommand(["which", command]);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
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

function findWindowsChromeExecutable(): string {
  for (const executablePath of windowsChromeInstallPaths()) {
    if (path.basename(executablePath).toLowerCase() === WINDOWS_CHROME_EXECUTABLE)
      return executablePath;
  }

  throw new Error("Could not find the Google Chrome executable.");
}

function getOpenChromeCommand(profileDirectory: string): OpenChromeCommand {
  const chromeArgs = [
    `--profile-directory=${profileDirectory}`,
    "--new-window",
    ABOUT_BLANK_URL,
  ];

  if (process.platform === "darwin") {
    return {
      command: "open",
      args: ["-n", "-a", findMacosChromeAppPath(), "--args", ...chromeArgs],
    };
  }

  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "start",
        '""',
        findWindowsChromeExecutable(),
        ...chromeArgs,
      ],
    };
  }

  return {
    command: "google-chrome",
    args: chromeArgs,
  };
}

function parseArgs(argv: string[]): ParsedArguments {
  const flags = new Set(argv);
  if (flags.has("-h") || flags.has("--help")) {
    usage();
    process.exit(0);
  }

  const supportedFlags = new Set(["--dry-run", "--json"]);
  const unsupportedFlags = argv.filter(
    (arg) => !supportedFlags.has(arg as "--dry-run" | "--json"),
  );
  if (unsupportedFlags.length > 0) {
    usage();
    process.exit(2);
  }

  return {
    dryRun: flags.has("--dry-run"),
    json: flags.has("--json"),
  };
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function printTextReport(result: OpenChromeResult): void {
  console.log("Google Chrome window open request");
  console.log(`status: ${result.dryRun ? "dry run" : "opened"}`);
  console.log(`profile: ${result.profileDirectory}`);
  console.log(`command: ${formatCommand(result.command, result.args)}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const preferencesPath = resolveChromePreferencesPath();
  const profileDirectory = path.basename(path.dirname(preferencesPath));
  const command = getOpenChromeCommand(profileDirectory);
  const result = {
    platform: process.platform,
    dryRun: args.dryRun,
    profileDirectory,
    command: command.command,
    args: command.args,
  };

  if (!args.dryRun) {
    execFileSync(command.command, command.args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
  }

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printTextReport(result);
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
