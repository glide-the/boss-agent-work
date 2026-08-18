#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const reconstructionRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(reconstructionRoot, "../../..");
const relativeAssetPath =
  "classic-level/prebuilds/darwin-x64+arm64/classic-level.node";
const inputPath = path.join(
  workspaceRoot,
  "components/codex-plugin/scripts-bak/node_modules",
  relativeAssetPath,
);
const outputPath = path.join(
  workspaceRoot,
  "components/codex-plugin/src/browser-client/vendor/prebuilds",
  relativeAssetPath,
);
const evidencePath = path.join(
  reconstructionRoot,
  "maps/third-party-runtime-assets.json",
);
const expectedHash =
  "e5555a5be604a47e4920bd93f8804ef33518aa1493e12709513f3bba7ee0096f";
const force = process.argv.slice(2).includes("--force");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const unexpected = process.argv.slice(2).filter((argument) => argument !== "--force");
  if (unexpected.length > 0)
    throw new Error("Usage: bun run materialize-third-party [--force]");
  const input = await readFile(inputPath);
  const inputHash = sha256(input);
  if (inputHash !== expectedHash)
    throw new Error(
      `Signed classic-level asset drifted: expected ${expectedHash}, received ${inputHash}.`,
    );
  try {
    await access(outputPath);
    if (!force)
      throw new Error(
        `Refusing to overwrite ${path.relative(workspaceRoot, outputPath)} without --force.`,
      );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(inputPath, outputPath);
  const evidence = {
    version: 1,
    classification: "confirmed-third-party-signed-runtime-asset",
    package: { name: "classic-level", version: "3.0.0" },
    input: path.relative(workspaceRoot, inputPath),
    canonicalAsset: path.relative(workspaceRoot, outputPath),
    runtimeDestination: `components/codex-plugin/scripts/node_modules/${relativeAssetPath}`,
    bytes: input.length,
    sha256: inputHash,
    signatureEvidence: {
      authority: "Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)",
      teamIdentifier: "2DC432GLL2",
      timestamp: "2026-07-10T00:07:37-07:00",
      verification: "codesign -dv --verbose=2 <asset>",
    },
    limitation:
      "The Developer ID signature cannot be reproduced from npm; this verified published binary is preserved as a vendor asset.",
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Materialized signed third-party asset ${inputHash}.`);
}

await main();
