#!/usr/bin/env bun

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  defaultInputRoot,
  defaultOutputRoot,
  extractArtifacts,
  generatedArtifactNames,
  reconstructionRoot,
  sha256,
  treeDigest,
  workspaceRoot,
} from "./extract-ast.mjs";

export async function reconstruct({ inputRoot = defaultInputRoot, outputRoot = defaultOutputRoot } = {}) {
  const inputManifest = JSON.parse(await readFile(path.join(reconstructionRoot, "input-manifest.json"), "utf8"));
  const digest = await treeDigest(inputRoot);
  assert.equal(digest.fileCount, inputManifest.fileCount, "input file count differs from input-manifest.json");
  assert.equal(digest.sha256, inputManifest.treeSha256, "input tree differs from input-manifest.json");

  const browserClient = await readFile(path.join(inputRoot, "browser-client.mjs"));
  assert.equal(browserClient.length, inputManifest.browserClient.bytes, "Browser Client byte count drifted");
  assert.equal(sha256(browserClient), inputManifest.browserClient.sha256, "Browser Client hash drifted");

  const summary = await extractArtifacts({ inputRoot, outputRoot });
  const artifacts = {};
  for (const name of generatedArtifactNames) {
    const contents = await readFile(path.join(outputRoot, name));
    artifacts[name] = { bytes: contents.length, sha256: sha256(contents) };
  }
  const reproductionManifest = {
    terminology: inputManifest.terminology,
    input: path.relative(workspaceRoot, inputRoot),
    inputTree: digest,
    packageManager: { name: "bun", version: Bun.version },
    parser: summary.parser,
    artifacts,
  };
  await writeFile(path.join(outputRoot, "reproduction-manifest.json"), `${JSON.stringify(reproductionManifest, null, 2)}\n`);
  return reproductionManifest;
}

if (import.meta.main) {
  const manifest = await reconstruct();
  console.log(`Reproduced ${Object.keys(manifest.artifacts).length} Browser Client evidence artifacts with Bun ${Bun.version}.`);
}
