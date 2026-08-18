#!/usr/bin/env bun

import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { reconstructionRoot, workspaceRoot } from "./extract-ast.mjs";

function parseArguments(argv) {
  const result = { force: false, includeInput: false, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") result.force = true;
    else if (argument === "--include-input") result.includeInput = true;
    else if (argument === "--output" && argv[index + 1]) {
      result.output = path.resolve(argv[index + 1]);
      index += 1;
    } else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  if (result.output === null) throw new Error("Usage: package-reconstruction.mjs --output DIRECTORY [--include-input] [--force]");
  return result;
}

async function exists(fileName) {
  try {
    await stat(fileName);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function excludesInstalledDependencies(source) {
  return !source.includes(`${path.sep}node_modules${path.sep}`)
    && path.basename(source) !== "node_modules";
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const forbidden = new Set([
    path.parse(options.output).root,
    path.resolve(os.homedir()),
    path.resolve(workspaceRoot),
    path.resolve(reconstructionRoot),
  ]);
  if (forbidden.has(options.output)) throw new Error(`Refusing unsafe package output: ${options.output}`);
  if (await exists(options.output)) {
    if (!options.force) throw new Error(`Output already exists: ${options.output}. Use --force to replace it.`);
    await rm(options.output, { recursive: true, force: true });
  }

  const targetReconstruction = path.join(options.output, "recovery/browser-client/reconstruction");
  const targetSource = path.join(options.output, "components/codex-plugin/src/browser-client");
  const targetScripts = path.join(options.output, "components/codex-plugin/scripts");
  await mkdir(path.dirname(targetReconstruction), { recursive: true });
  await cp(reconstructionRoot, targetReconstruction, {
    recursive: true,
    filter: excludesInstalledDependencies,
  });
  await cp(path.join(workspaceRoot, "components/codex-plugin/src/browser-client"), targetSource, {
    recursive: true,
    filter: excludesInstalledDependencies,
  });
  await cp(path.join(workspaceRoot, "components/codex-plugin/scripts"), targetScripts, { recursive: true });

  if (options.includeInput) {
    await cp(
      path.join(workspaceRoot, "components/codex-plugin/scripts-bak"),
      path.join(options.output, "components/codex-plugin/scripts-bak"),
      { recursive: true },
    );
  }

  const inputManifest = JSON.parse(await readFile(path.join(reconstructionRoot, "input-manifest.json"), "utf8"));
  await writeFile(path.join(options.output, "README.md"), `# Portable Browser Client Reconstruction\n\n` +
    `Input included: ${options.includeInput ? "yes" : "no"}\n\n` +
    `Input tree SHA-256: ${inputManifest.treeSha256}\n\n` +
    `Run:\n\n` +
    "```bash\n" +
    "cd recovery/browser-client/reconstruction\n" +
    "bun install --frozen-lockfile\n" +
    `${options.includeInput ? "bun run reproduce\nbun run verify\n" : "# Reproduction requires components/codex-plugin/scripts-bak.\n"}` +
    "```\n");
  console.log(`Packaged Browser Client reconstruction resources: ${options.output}`);
}

await main();
