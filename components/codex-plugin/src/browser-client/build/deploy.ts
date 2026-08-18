#!/usr/bin/env bun

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { expectedFirstPartyOutputs } from "./inventory.ts";

const sourceRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(sourceRoot, "../../../..");
const candidateRoot = path.join(workspaceRoot, "recovery/browser-client/dist");
const scriptsRoot = path.join(
  workspaceRoot,
  "components/codex-plugin/scripts",
);
const backupRoot = path.join(
  workspaceRoot,
  "components/codex-plugin/scripts-bak",
);
const backupManifestPath = path.join(
  workspaceRoot,
  "recovery/browser-client/fixtures/scripts-backup-manifest.json",
);
const deploymentReportPath = path.join(
  workspaceRoot,
  "recovery/browser-client/deployment-report.json",
);

interface TreeDigest {
  fileCount: number;
  sha256: string;
}

function objectRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

async function regularFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await regularFiles(root, filePath)));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

async function treeDigest(root: string): Promise<TreeDigest> {
  const files = (await regularFiles(root)).sort((left, right) =>
    left.localeCompare(right),
  );
  const hash = createHash("sha256");
  for (const fileName of files) {
    hash.update(path.relative(root, fileName));
    hash.update("\0");
    hash.update(await readFile(fileName));
    hash.update("\0");
  }
  return { fileCount: files.length, sha256: hash.digest("hex") };
}

async function verifyImmutableBackup(): Promise<TreeDigest> {
  const manifest = objectRecord(
    JSON.parse(await readFile(backupManifestPath, "utf8")),
  );
  const digest = await treeDigest(backupRoot);
  assert.equal(digest.fileCount, manifest.fileCount, "scripts-bak file count drifted");
  assert.equal(digest.sha256, manifest.treeSha256, "scripts-bak hash drifted");
  return digest;
}

async function runVerification(): Promise<void> {
  const child = Bun.spawn(["bun", path.join(sourceRoot, "build/verify.ts")], {
    cwd: sourceRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(`Canonical verification failed with exit code ${exitCode}.`);
}

async function assertExactTopLevel(
  root: string,
  additionalFiles: readonly string[] = [],
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    files,
    [...expectedFirstPartyOutputs, ...additionalFiles].sort(),
    `unexpected files in ${root}`,
  );
  assert.deepEqual(directories, ["node_modules"], `unexpected directories in ${root}`);
}

async function prepareDeploymentTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const name of expectedFirstPartyOutputs) {
    await cp(path.join(source, name), path.join(destination, name));
  }
  await cp(path.join(source, "node_modules"), path.join(destination, "node_modules"), {
    recursive: true,
  });

  const manifestPath = path.join(candidateRoot, "build-manifest.json");
  if (source === candidateRoot) {
    const manifest = objectRecord(JSON.parse(await readFile(manifestPath, "utf8")));
    const outputs = manifest.outputs;
    assert.equal(Array.isArray(outputs), true);
    for (const output of outputs as unknown[]) {
      const record = objectRecord(output);
      const outputName = String(record.output);
      const mode = Number.parseInt(String(record.mode), 8);
      await chmod(path.join(destination, outputName), mode);
    }
  } else {
    for (const name of expectedFirstPartyOutputs) {
      const mode = (await stat(path.join(source, name))).mode & 0o777;
      await chmod(path.join(destination, name), mode);
    }
  }
}

async function swapScriptsTree(source: string): Promise<TreeDigest> {
  const parent = path.dirname(scriptsRoot);
  const identifier = randomUUID();
  const nextRoot = path.join(parent, `scripts.next-${identifier}`);
  const previousRoot = path.join(parent, `scripts.previous-${identifier}`);
  await prepareDeploymentTree(source, nextRoot);
  await assertExactTopLevel(nextRoot);
  let previousMoved = false;
  try {
    await rename(scriptsRoot, previousRoot);
    previousMoved = true;
    await rename(nextRoot, scriptsRoot);
  } catch (error) {
    await rm(nextRoot, { recursive: true, force: true });
    if (previousMoved) await rename(previousRoot, scriptsRoot);
    throw error;
  }
  await rm(previousRoot, { recursive: true, force: true });
  return await treeDigest(scriptsRoot);
}

async function deploy(): Promise<void> {
  const backup = await verifyImmutableBackup();
  await runVerification();
  await assertExactTopLevel(candidateRoot, ["build-manifest.json"]);
  const candidate = await treeDigest(candidateRoot);
  const deployed = await swapScriptsTree(candidateRoot);
  assert.equal(deployed.fileCount, candidate.fileCount - 1);
  const report = {
    action: "deploy",
    createdAt: new Date().toISOString(),
    backup,
    candidate,
    deployed,
    deployedOutputs: expectedFirstPartyOutputs,
    sourceRoot: path.relative(workspaceRoot, sourceRoot),
    scriptsRoot: path.relative(workspaceRoot, scriptsRoot),
  };
  await writeFile(deploymentReportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Atomically deployed canonical Browser Client tree to ${scriptsRoot}.`);
}

async function checkDeployed(): Promise<void> {
  await verifyImmutableBackup();
  await runVerification();
  await assertExactTopLevel(scriptsRoot);
  const temporaryRoot = path.join(
    path.dirname(scriptsRoot),
    `scripts.check-${randomUUID()}`,
  );
  try {
    await prepareDeploymentTree(candidateRoot, temporaryRoot);
    assert.deepEqual(await treeDigest(scriptsRoot), await treeDigest(temporaryRoot));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  console.log("Deployed scripts tree matches the canonical Bun build.");
}

async function rollback(): Promise<void> {
  const backup = await verifyImmutableBackup();
  const restored = await swapScriptsTree(backupRoot);
  assert.deepEqual(restored, backup);
  await writeFile(
    deploymentReportPath,
    `${JSON.stringify(
      {
        action: "rollback",
        createdAt: new Date().toISOString(),
        backup,
        restored,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Restored immutable Browser Client baseline to ${scriptsRoot}.`);
}

const arguments_ = process.argv.slice(2);
if (arguments_.length === 0) await deploy();
else if (arguments_.length === 1 && arguments_[0] === "--check")
  await checkDeployed();
else if (arguments_.length === 1 && arguments_[0] === "--rollback")
  await rollback();
else throw new Error("Usage: bun run deploy [--check|--rollback]");
