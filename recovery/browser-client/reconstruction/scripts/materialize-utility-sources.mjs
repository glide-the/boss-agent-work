#!/usr/bin/env bun

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { reconstructionRoot, workspaceRoot } from "./extract-ast.mjs";

async function exists(fileName) {
  try {
    await stat(fileName);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function addRecoveryHeader(source, sourcePath) {
  const header = [
    "// Semantic-equivalent TypeScript recovery.",
    `// Evidence source: ${sourcePath}`,
    "// Do not present reconstructed names or types as the author's originals.",
  ].join("\n");
  if (source.startsWith("#!")) {
    const newline = source.indexOf("\n");
    return `${source.slice(0, newline + 1)}${header}\n${source.slice(newline + 1)}`;
  }
  return `${header}\n${source}`;
}

const force = process.argv.slice(2).includes("--force");
const semanticMap = JSON.parse(await readFile(
  path.join(reconstructionRoot, "maps/utility-scripts.semantic-map.json"),
  "utf8",
));

for (const entry of semanticMap.entries) {
  const sourcePath = path.join(workspaceRoot, entry.source);
  const targetPath = path.join(workspaceRoot, entry.targetModule);
  const allowedRoot = path.join(workspaceRoot, "components/codex-plugin/src/browser-client/scripts") + path.sep;
  if (!targetPath.startsWith(allowedRoot)) {
    throw new Error(`Refusing target outside canonical scripts source: ${targetPath}`);
  }
  if (!force && await exists(targetPath)) {
    throw new Error(`Target already exists: ${targetPath}. Review it instead of overwriting, or use --force explicitly.`);
  }
  const source = await readFile(sourcePath, "utf8");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, addRecoveryHeader(source, entry.source));
  console.log(`Materialized ${entry.source} -> ${entry.targetModule}`);
}
