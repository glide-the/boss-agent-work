#!/usr/bin/env bun

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  defaultInputRoot,
  defaultOutputRoot,
  generatedArtifactNames,
  reconstructionRoot,
  sha256,
  treeDigest,
  workspaceRoot,
} from "./extract-ast.mjs";
import { reconstruct } from "./reconstruct.mjs";

const allowedClassifications = new Set(["confirmed", "inferred", "reconstructed", "unresolved"]);

async function requireFile(fileName) {
  const information = await stat(fileName);
  assert.equal(information.isFile(), true, `required file is not regular: ${fileName}`);
}

async function verifyBrowserSemanticMap() {
  const mapPath = path.join(reconstructionRoot, "maps/browser-client.semantic-map.json");
  const semanticMap = JSON.parse(await readFile(mapPath, "utf8"));
  const sourcePath = path.join(workspaceRoot, semanticMap.source);
  const source = await readFile(sourcePath, "utf8");
  assert.ok(Array.isArray(semanticMap.entries) && semanticMap.entries.length > 0);
  for (const entry of semanticMap.entries) {
    assert.equal(typeof entry.anchor, "string");
    const actualOffset = source.indexOf(entry.anchor);
    assert.notEqual(actualOffset, -1, `semantic anchor missing: ${entry.anchor}`);
    assert.equal(allowedClassifications.has(entry.classification), true, `invalid classification: ${entry.classification}`);
    assert.equal(typeof entry.confidence, "number");
    assert.ok(entry.confidence >= 0 && entry.confidence <= 1);
    assert.ok(Array.isArray(entry.evidence) && entry.evidence.length > 0);
    assert.ok(Array.isArray(entry.verification) && entry.verification.length > 0);
    assert.ok(entry.targetModule.startsWith("components/codex-plugin/src/browser-client/"));
    if (entry.range) {
      assert.equal(entry.range.start, actualOffset, `semantic range drifted: ${entry.anchor}`);
      assert.equal(entry.range.end, actualOffset + entry.anchor.length, `semantic range end drifted: ${entry.anchor}`);
    }
  }
}

async function verifyUtilitySemanticMap() {
  const semanticMap = JSON.parse(await readFile(path.join(reconstructionRoot, "maps/utility-scripts.semantic-map.json"), "utf8"));
  assert.ok(Array.isArray(semanticMap.entries) && semanticMap.entries.length === 5);
  for (const entry of semanticMap.entries) {
    await requireFile(path.join(workspaceRoot, entry.source));
    assert.ok(entry.targetModule.startsWith("components/codex-plugin/src/browser-client/scripts/"));
    assert.equal(allowedClassifications.has(entry.classification), true);
    assert.ok(Array.isArray(entry.evidence) && entry.evidence.length > 0);
    assert.ok(Array.isArray(entry.verification) && entry.verification.length > 0);
  }
}

async function verifyRequiredResources() {
  const required = [
    "README.md",
    "TASK_PLANNING.md",
    "LOCAL_VERIFICATION.md",
    "SECURITY.md",
    "input-manifest.json",
    "diagrams/recovery-pipeline.mmd",
    "diagrams/runtime-protocol.mmd",
    "diagrams/module-dependencies.mmd",
    "maps/browser-client.semantic-map.json",
    "maps/utility-scripts.semantic-map.json",
    "maps/module-boundaries.json",
    ...Array.from({ length: 11 }, (_, index) => `analysis/${String(index).padStart(2, "0")}-${[
      "sample-info",
      "sourcemap-check",
      "file-inventory",
      "bundle-fingerprint",
      "ast-static-index",
      "protocol-and-security-index",
      "semantic-renaming",
      "module-reconstruction-plan",
      "runtime-differential-validation",
      "confidence-report",
      "limitations",
    ][index]}.md`),
  ];
  for (const name of required) await requireFile(path.join(reconstructionRoot, name));
}

async function main() {
  const watchedRoots = [
    path.join(workspaceRoot, "components/codex-plugin/scripts-bak"),
    path.join(workspaceRoot, "components/codex-plugin/scripts"),
    path.join(workspaceRoot, "components/codex-plugin/src/browser-client"),
  ];
  const before = await Promise.all(watchedRoots.map(treeDigest));
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "browser-client-reconstruction-"));
  try {
    await reconstruct({ inputRoot: defaultInputRoot, outputRoot: temporaryRoot });
    for (const name of generatedArtifactNames) {
      const [expected, reproduced] = await Promise.all([
        readFile(path.join(defaultOutputRoot, name)),
        readFile(path.join(temporaryRoot, name)),
      ]);
      assert.equal(sha256(reproduced), sha256(expected), `artifact is not reproducible: ${name}`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  const after = await Promise.all(watchedRoots.map(treeDigest));
  assert.deepEqual(after, before, "reconstruction verification modified a protected source/input/output tree");

  const inputManifest = JSON.parse(await readFile(path.join(reconstructionRoot, "input-manifest.json"), "utf8"));
  assert.deepEqual(await treeDigest(defaultInputRoot), {
    fileCount: inputManifest.fileCount,
    sha256: inputManifest.treeSha256,
  });
  await verifyRequiredResources();
  await verifyBrowserSemanticMap();
  await verifyUtilitySemanticMap();

  console.log(JSON.stringify({
    correct: true,
    artifacts: generatedArtifactNames.length,
    inputTreeSha256: inputManifest.treeSha256,
    maps: 3,
    diagrams: 3,
    analysisReports: 11,
    protectedTreesUnchanged: true,
  }, null, 2));
}

await main();
