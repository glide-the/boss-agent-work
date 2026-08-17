#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const toolDirectory = import.meta.dirname;
const workspaceRoot = path.resolve(toolDirectory, "../..");
const sourceRoot = path.join(workspaceRoot, "components/codex-plugin/src/browser-client");
const tsconfigPath = path.join(sourceRoot, "tsconfig.json");
const outputRoot = path.join(workspaceRoot, "recovery/browser-client/dist");
const baselinePath = path.join(workspaceRoot, "components/codex-plugin/scripts/browser-client.mjs");
const browserClientEntry = path.join(sourceRoot, "index.ts");
const siteStatusEntry = path.join(sourceRoot, "security/site-status-policy.ts");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function diagnosticsText(diagnostics) {
  return diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (!diagnostic.file || diagnostic.start == null) return `TS${diagnostic.code}: ${message}`;
    const point = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${diagnostic.file.fileName}:${point.line + 1}:${point.character + 1} TS${diagnostic.code}: ${message}`;
  }).join("\n");
}

function bunLogsText(logs) {
  return logs.map((log) => {
    if (typeof log === "string") return log;
    if (typeof log?.message === "string") return log.message;
    return String(log);
  }).join("\n");
}

function loadTypeScriptConfiguration() {
  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (read.error) throw new Error(diagnosticsText([read.error]));
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    sourceRoot,
    { noEmit: true },
    tsconfigPath,
  );
  if (parsed.errors.length > 0) throw new Error(diagnosticsText(parsed.errors));
  return parsed;
}

async function typecheck() {
  const configuration = loadTypeScriptConfiguration();
  const program = ts.createProgram(configuration.fileNames, configuration.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) throw new Error(diagnosticsText(diagnostics));
  return configuration.fileNames.sort();
}

async function bundle() {
  const result = await Bun.build({
    entrypoints: [browserClientEntry, siteStatusEntry],
    root: sourceRoot,
    outdir: outputRoot,
    target: "node",
    format: "esm",
    splitting: false,
    sourcemap: "none",
    minify: false,
    naming: {
      entry: "[dir]/[name].mjs",
    },
  });
  if (!result.success) {
    throw new Error(`Bun.build failed:\n${bunLogsText(result.logs)}`);
  }
  const generatedIndex = path.join(outputRoot, "index.mjs");
  const generatedEntry = path.join(outputRoot, "browser-client.mjs");
  await rename(generatedIndex, generatedEntry);
  return {
    generatedEntry,
    outputPaths: result.outputs
      .map((output) => output.path === generatedIndex ? generatedEntry : output.path)
      .sort(),
  };
}

async function main() {
  if (typeof globalThis.Bun?.build !== "function") {
    throw new Error("This build must run with Bun because Bun.build produces the recovery artifacts.");
  }
  const sourceFiles = await typecheck();
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const { generatedEntry, outputPaths } = await bundle();

  const baseline = await readFile(baselinePath);
  const sourceHashes = {};
  for (const fileName of sourceFiles) {
    const contents = await readFile(fileName);
    sourceHashes[path.relative(workspaceRoot, fileName)] = sha256(contents);
  }
  const outputs = [];
  for (const fileName of outputPaths) {
    const contents = await readFile(fileName);
    outputs.push({
      path: path.relative(workspaceRoot, fileName),
      bytes: contents.length,
      sha256: sha256(contents),
    });
  }

  const manifest = {
    terminology: "semantic-equivalent source recovery / maintainable modular reconstruction",
    compatibilityStrategy: "Phase 1 delegates unrecovered runtime behavior to the verified bundle.",
    packageManager: {
      name: "bun",
      version: Bun.version,
      lockfile: "tools/browser-client-recovery/bun.lock",
    },
    bundler: {
      name: "Bun.build",
      version: Bun.version,
      target: "node",
      format: "esm",
      splitting: false,
      minify: false,
      sourcemap: "none",
    },
    baseline: {
      path: path.relative(workspaceRoot, baselinePath),
      bytes: baseline.length,
      sha256: sha256(baseline),
    },
    entry: path.relative(workspaceRoot, generatedEntry),
    outputs,
    sourceHashes,
    typechecker: {
      name: "TypeScript Compiler API",
      version: ts.version,
      strict: true,
      sourceFileCount: sourceFiles.length,
    },
  };
  await writeFile(
    path.join(outputRoot, "build-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`Typechecked ${sourceFiles.length} recovered source files with TypeScript ${ts.version}.`);
  console.log(`Bundled ${outputs.length} Node ESM artifacts with Bun ${Bun.version}.`);
  console.log(`Built Browser Client candidate ${generatedEntry}`);
}

await main();
