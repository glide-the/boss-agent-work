#!/usr/bin/env node
// Semantic-equivalent TypeScript recovery.
// Evidence source: components/codex-plugin/scripts-bak/chrome-is-running.js
// Do not present reconstructed names or types as the author's originals.
/* global console */
/* Detect whether Google Chrome is currently running. */

type NodePath = typeof import("node:path");
type NodeProcess = typeof globalThis.process;
type ExecFileSync = typeof import("node:child_process").execFileSync;
type ReadlinkSync = typeof import("node:fs").readlinkSync;

interface ChromeProcess {
  pid: number;
  process_name: string;
  command: string;
}

interface ChromeRunningResult {
  platform: NodeJS.Platform;
  running: boolean;
  processes: ChromeProcess[];
}

interface ParsedArguments {
  check: boolean;
  json: boolean;
}

let path: NodePath;
let process: NodeProcess = globalThis.process;
let execFileSync: ExecFileSync;
let readlinkSync: ReadlinkSync;

const MACOS_CHROME_PROCESS_NAMES: ReadonlySet<string> = new Set([
  "Google Chrome",
  "Google Chrome Helper",
]);

const CHROME_PROCESS_NAMES_BY_PLATFORM: Partial<
  Record<NodeJS.Platform, ReadonlySet<string>>
> = {
  darwin: MACOS_CHROME_PROCESS_NAMES,
  win32: new Set(["chrome.exe"]),
};

const MACOS_CHROME_APP_PATH_FRAGMENT = "/Google Chrome.app/Contents/";
const MACOS_CHROME_SINGLETON_LOCK_PATH = [
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "SingletonLock",
];

async function loadNodeModules(): Promise<void> {
  path = await import("node:path");
  process = (await import("node:process")).default;
  ({ execFileSync } = await import("node:child_process"));
  ({ readlinkSync } = await import("node:fs"));
}

function usage(): void {
  console.error("Usage: scripts/chrome-is-running.js [--check] [--json]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function formatCommandError(
  command: string,
  args: string[],
  error: unknown,
): string {
  const commandDisplay = [command, ...args].join(" ");
  const errorRecord = isRecord(error) ? error : undefined;
  const stderr = errorRecord?.stderr;
  const details = [
    errorCode(error),
    typeof errorRecord?.status === "number"
      ? `exit ${errorRecord.status}`
      : null,
    stderr == null ? null : String(stderr).trim(),
    error instanceof Error ? error.message : null,
  ].filter(Boolean);
  return `Failed to run ${commandDisplay}: ${details.join("; ")}`;
}

function runCommand(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(formatCommandError(command, args, error), { cause: error });
  }
}

function stripCommandArguments(command: string): string {
  return command.trim().replace(/\s--.*$/, "");
}

function chromeProcessNameForCommand(command: string): string {
  const executable = stripCommandArguments(command);
  const processName = path.basename(executable);

  if (process.platform === "darwin") {
    if (!executable.includes(MACOS_CHROME_APP_PATH_FRAGMENT))
      return processName;

    if (
      processName === "Google Chrome" ||
      processName.startsWith("Google Chrome Helper")
    )
      return processName;
  }

  return processName;
}

function parseProcessList(
  output: string,
  processNames: ReadonlySet<string>,
): ChromeProcess[] {
  if (!output) return [];

  const processes: ChromeProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!match) continue;

    const pid = match[1];
    const command = match[2];
    if (pid == null || command == null) continue;
    const processName = chromeProcessNameForCommand(command);
    if (!processNames.has(processName)) continue;

    processes.push({
      pid: Number(pid),
      process_name: processName,
      command: stripCommandArguments(command),
    });
  }

  return processes;
}

function parseMacosApplicationProcessList(output: string): ChromeProcess[] {
  const processes = parseProcessList(
    output,
    MACOS_CHROME_PROCESS_NAMES,
  );

  return processes.filter((chromeProcess) => {
    return chromeProcess.command.includes(MACOS_CHROME_APP_PATH_FRAGMENT);
  });
}

function parseWindowsTaskList(output: string): ChromeProcess[] {
  if (!output) return [];

  const processes: ChromeProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)","(\d+)",/);
    const processName = match?.[1];
    const pid = match?.[2];
    if (processName == null || pid == null) continue;
    if (processName.toLowerCase() !== "chrome.exe") continue;

    processes.push({
      pid: Number(pid),
      process_name: processName,
      command: processName,
    });
  }

  return processes;
}

function getMacosChromeSingletonProcess(): ChromeProcess | null {
  if (!process.env.HOME) return null;

  let singletonLockTarget: string;
  try {
    singletonLockTarget = readlinkSync(
      path.join(process.env.HOME, ...MACOS_CHROME_SINGLETON_LOCK_PATH),
      "utf8",
    );
  } catch {
    return null;
  }

  const pidMatch = singletonLockTarget.match(/-(\d+)$/);
  if (!pidMatch) return null;

  const pid = Number(pidMatch[1]);
  if (!Number.isInteger(pid) || pid <= 0) return null;

  try {
    process.kill(pid, 0);
  } catch (error) {
    if (errorCode(error) !== "EPERM") return null;
  }

  return {
    pid,
    process_name: "Google Chrome",
    command: "Google Chrome",
  };
}

function findRunningChromeProcesses(): ChromeProcess[] {
  const processNames =
    CHROME_PROCESS_NAMES_BY_PLATFORM[process.platform] || new Set(["chrome"]);

  if (process.platform === "win32") {
    return parseWindowsTaskList(
      runCommand("tasklist", [
        "/fo",
        "csv",
        "/nh",
        "/fi",
        "imagename eq chrome.exe",
      ]),
    );
  }

  const singletonProcess =
    process.platform === "darwin" ? getMacosChromeSingletonProcess() : null;

  let processList: string;
  try {
    processList = runCommand("ps", ["-A", "-o", "pid=", "-o", "comm="]);
  } catch (error) {
    if (singletonProcess != null) return [singletonProcess];

    throw error;
  }

  const processes = parseProcessList(processList, processNames);
  if (processes.length > 0 || process.platform !== "darwin") return processes;

  try {
    return parseMacosApplicationProcessList(
      runCommand("ps", ["-A", "-ww", "-o", "pid=", "-o", "command="]),
    );
  } catch (error) {
    if (singletonProcess != null) return [singletonProcess];

    throw error;
  }
}

function parseArgs(argv: string[]): ParsedArguments {
  const flags = new Set(argv);
  if (flags.has("-h") || flags.has("--help")) {
    usage();
    process.exit(0);
  }

  const supportedFlags = new Set(["--check", "--json"]);
  const unsupportedFlags = argv.filter(
    (arg) => !supportedFlags.has(arg as "--check" | "--json"),
  );
  if (unsupportedFlags.length > 0) {
    usage();
    process.exit(2);
  }

  return {
    check: flags.has("--check"),
    json: flags.has("--json"),
  };
}

function printTextReport(result: ChromeRunningResult, check: boolean): void {
  if (check) {
    console.log("Google Chrome running check");
    console.log(`status: ${result.running ? "ok" : "not running"}`);
    console.log("");
  }

  console.log(`Google Chrome running: ${result.running ? "yes" : "no"}`);
  if (result.processes.length === 0) return;

  console.log("Processes:");
  for (const chromeProcess of result.processes) {
    console.log(`  - pid: ${chromeProcess.pid}`);
    console.log(`    process: ${chromeProcess.process_name}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const processes = findRunningChromeProcesses();
  const result = {
    platform: process.platform,
    running: processes.length > 0,
    processes,
  };

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printTextReport(result, args.check);

  if (args.check && !result.running) process.exitCode = 1;
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
