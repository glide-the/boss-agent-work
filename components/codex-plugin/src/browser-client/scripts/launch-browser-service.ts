#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";

import {
  createPersonalBrowserLaunchPlan,
  probePersonalBrowserService,
} from "../runtime/trusted-service.ts";

const pluginRoot = path.resolve(import.meta.dirname, "..");

try {
  const plan = await createPersonalBrowserLaunchPlan({ pluginRoot });
  if (process.argv.slice(2).includes("--probe")) {
    const result = await probePersonalBrowserService(plan);
    console.log(JSON.stringify(result));
    process.exit(0);
  }
  const child = spawn(plan.executable, [], { env: plan.environment, stdio: "inherit" });
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const forwardSignal = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };
  for (const signal of signals) process.on(signal, forwardSignal);
  child.once("error", (error) => {
    console.error(`Boss投递 runtime could not start: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    for (const name of signals) process.off(name, forwardSignal);
    if (signal !== null) process.kill(process.pid, signal);
    else process.exitCode = code !== null && code >= 0 ? code : 1;
  });
} catch (error) {
  console.error(
    `Boss投递 runtime could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
