#!/usr/bin/env node
import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// scripts/chrome-is-running.ts
var path;
var process = globalThis.process;
var execFileSync;
var readlinkSync;
var MACOS_CHROME_PROCESS_NAMES = new Set([
  "Google Chrome",
  "Google Chrome Helper"
]);
var CHROME_PROCESS_NAMES_BY_PLATFORM = {
  darwin: MACOS_CHROME_PROCESS_NAMES,
  win32: new Set(["chrome.exe"])
};
var MACOS_CHROME_APP_PATH_FRAGMENT = "/Google Chrome.app/Contents/";
var MACOS_CHROME_SINGLETON_LOCK_PATH = [
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "SingletonLock"
];
async function loadNodeModules() {
  path = await import("node:path");
  process = (await import("node:process")).default;
  ({ execFileSync } = await import("node:child_process"));
  ({ readlinkSync } = await import("node:fs"));
}
function usage() {
  console.error("Usage: scripts/chrome-is-running.js [--check] [--json]");
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function errorCode(error) {
  if (!isRecord(error))
    return;
  return typeof error.code === "string" ? error.code : undefined;
}
function formatCommandError(command, args, error) {
  const commandDisplay = [command, ...args].join(" ");
  const errorRecord = isRecord(error) ? error : undefined;
  const stderr = errorRecord?.stderr;
  const details = [
    errorCode(error),
    typeof errorRecord?.status === "number" ? `exit ${errorRecord.status}` : null,
    stderr == null ? null : String(stderr).trim(),
    error instanceof Error ? error.message : null
  ].filter(Boolean);
  return `Failed to run ${commandDisplay}: ${details.join("; ")}`;
}
function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    throw new Error(formatCommandError(command, args, error), { cause: error });
  }
}
function stripCommandArguments(command) {
  return command.trim().replace(/\s--.*$/, "");
}
function chromeProcessNameForCommand(command) {
  const executable = stripCommandArguments(command);
  const processName = path.basename(executable);
  if (process.platform === "darwin") {
    if (!executable.includes(MACOS_CHROME_APP_PATH_FRAGMENT))
      return processName;
    if (processName === "Google Chrome" || processName.startsWith("Google Chrome Helper"))
      return processName;
  }
  return processName;
}
function parseProcessList(output, processNames) {
  if (!output)
    return [];
  const processes = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!match)
      continue;
    const pid = match[1];
    const command = match[2];
    if (pid == null || command == null)
      continue;
    const processName = chromeProcessNameForCommand(command);
    if (!processNames.has(processName))
      continue;
    processes.push({
      pid: Number(pid),
      process_name: processName,
      command: stripCommandArguments(command)
    });
  }
  return processes;
}
function parseMacosApplicationProcessList(output) {
  const processes = parseProcessList(output, MACOS_CHROME_PROCESS_NAMES);
  return processes.filter((chromeProcess) => {
    return chromeProcess.command.includes(MACOS_CHROME_APP_PATH_FRAGMENT);
  });
}
function parseWindowsTaskList(output) {
  if (!output)
    return [];
  const processes = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)","(\d+)",/);
    const processName = match?.[1];
    const pid = match?.[2];
    if (processName == null || pid == null)
      continue;
    if (processName.toLowerCase() !== "chrome.exe")
      continue;
    processes.push({
      pid: Number(pid),
      process_name: processName,
      command: processName
    });
  }
  return processes;
}
function getMacosChromeSingletonProcess() {
  if (!process.env.HOME)
    return null;
  let singletonLockTarget;
  try {
    singletonLockTarget = readlinkSync(path.join(process.env.HOME, ...MACOS_CHROME_SINGLETON_LOCK_PATH), "utf8");
  } catch {
    return null;
  }
  const pidMatch = singletonLockTarget.match(/-(\d+)$/);
  if (!pidMatch)
    return null;
  const pid = Number(pidMatch[1]);
  if (!Number.isInteger(pid) || pid <= 0)
    return null;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (errorCode(error) !== "EPERM")
      return null;
  }
  return {
    pid,
    process_name: "Google Chrome",
    command: "Google Chrome"
  };
}
function findRunningChromeProcesses() {
  const processNames = CHROME_PROCESS_NAMES_BY_PLATFORM[process.platform] || new Set(["chrome"]);
  if (process.platform === "win32") {
    return parseWindowsTaskList(runCommand("tasklist", [
      "/fo",
      "csv",
      "/nh",
      "/fi",
      "imagename eq chrome.exe"
    ]));
  }
  const singletonProcess = process.platform === "darwin" ? getMacosChromeSingletonProcess() : null;
  let processList;
  try {
    processList = runCommand("ps", ["-A", "-o", "pid=", "-o", "comm="]);
  } catch (error) {
    if (singletonProcess != null)
      return [singletonProcess];
    throw error;
  }
  const processes = parseProcessList(processList, processNames);
  if (processes.length > 0 || process.platform !== "darwin")
    return processes;
  try {
    return parseMacosApplicationProcessList(runCommand("ps", ["-A", "-ww", "-o", "pid=", "-o", "command="]));
  } catch (error) {
    if (singletonProcess != null)
      return [singletonProcess];
    throw error;
  }
}
function parseArgs(argv) {
  const flags = new Set(argv);
  if (flags.has("-h") || flags.has("--help")) {
    usage();
    process.exit(0);
  }
  const supportedFlags = new Set(["--check", "--json"]);
  const unsupportedFlags = argv.filter((arg) => !supportedFlags.has(arg));
  if (unsupportedFlags.length > 0) {
    usage();
    process.exit(2);
  }
  return {
    check: flags.has("--check"),
    json: flags.has("--json")
  };
}
function printTextReport(result, check) {
  if (check) {
    console.log("Google Chrome running check");
    console.log(`status: ${result.running ? "ok" : "not running"}`);
    console.log("");
  }
  console.log(`Google Chrome running: ${result.running ? "yes" : "no"}`);
  if (result.processes.length === 0)
    return;
  console.log("Processes:");
  for (const chromeProcess of result.processes) {
    console.log(`  - pid: ${chromeProcess.pid}`);
    console.log(`    process: ${chromeProcess.process_name}`);
  }
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  const processes = findRunningChromeProcesses();
  const result = {
    platform: process.platform,
    running: processes.length > 0,
    processes
  };
  if (args.json)
    console.log(JSON.stringify(result, null, 2));
  else
    printTextReport(result, args.check);
  if (args.check && !result.running)
    process.exitCode = 1;
}
loadNodeModules().then(() => {
  main();
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
