#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
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
import ts from "typescript";

import {
  allBuildEntries,
  configEntries,
  expectedFirstPartyOutputs,
  runtimeAdapterEntries,
  runtimeDependencyPackages,
  utilityEntries,
  type BuildEntry,
} from "./inventory.ts";

const sourceRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(sourceRoot, "../../../..");
const recoveryRoot = path.join(workspaceRoot, "recovery/browser-client");
const utilitiesOnly = process.argv.slice(2).includes("--utilities-only");
const unexpectedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--utilities-only");
const outputRoot = path.join(
  recoveryRoot,
  utilitiesOnly ? "utilities-dist" : "dist",
);
const temporaryOutputRoot = `${outputRoot}.next`;
const entries = utilitiesOnly ? utilityEntries : allBuildEntries;
const artifactEntries = [...entries, ...runtimeAdapterEntries];

const forbiddenProductionSegments = [
  `${path.sep}components${path.sep}codex-plugin${path.sep}scripts-bak${path.sep}`,
  `${path.sep}components${path.sep}codex-plugin${path.sep}scripts${path.sep}`,
  `${path.sep}tools${path.sep}browser-client-recovery${path.sep}`,
];

function sha256(contents: Uint8Array | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function relativeToWorkspace(filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
}

function diagnosticsText(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      );
      if (diagnostic.file == null || diagnostic.start == null)
        return `TS${diagnostic.code}: ${message}`;
      const point = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start,
      );
      return `${relativeToWorkspace(diagnostic.file.fileName)}:${point.line + 1}:${point.character + 1} TS${diagnostic.code}: ${message}`;
    })
    .join("\n");
}

function loadTypeScriptProgram(): ts.Program {
  const tsconfigPath = path.join(sourceRoot, "tsconfig.json");
  const loaded = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (loaded.error != null) throw new Error(diagnosticsText([loaded.error]));
  const configuration = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    sourceRoot,
    { noEmit: true },
    tsconfigPath,
  );
  if (configuration.errors.length > 0)
    throw new Error(diagnosticsText(configuration.errors));
  const program = ts.createProgram(configuration.fileNames, configuration.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) throw new Error(diagnosticsText(diagnostics));
  return program;
}

function resolveRelativeTypeScriptImport(
  importer: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const unresolved = path.resolve(path.dirname(importer), specifier);
  const candidates = specifier.endsWith(".ts")
    ? [unresolved]
    : specifier.endsWith(".js") || specifier.endsWith(".mjs")
      ? [unresolved, unresolved.replace(/\.(?:m?js)$/u, ".ts")]
      : [`${unresolved}.ts`, path.join(unresolved, "index.ts")];
  return candidates.find((candidate) => ts.sys.fileExists(candidate)) ?? null;
}

function assertCanonicalDependencyGraph(
  program: ts.Program,
  selectedEntries: BuildEntry[],
): string[] {
  const pending = selectedEntries.map((entry) =>
    path.resolve(sourceRoot, entry.source),
  );
  const visited = new Set<string>();

  while (pending.length > 0) {
    const fileName = pending.pop();
    if (fileName == null || visited.has(fileName)) continue;
    visited.add(fileName);
    for (const forbidden of forbiddenProductionSegments) {
      if (fileName.includes(forbidden))
        throw new Error(`Forbidden production dependency: ${fileName}`);
    }
    const sourceFile =
      program.getSourceFile(fileName) ??
      ts.createSourceFile(
        fileName,
        ts.sys.readFile(fileName) ?? "",
        ts.ScriptTarget.ESNext,
        true,
        fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
      );
    for (const statement of sourceFile.statements) {
      if (
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier != null &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const specifier = statement.moduleSpecifier.text;
        if (
          specifier === "#browser-client-baseline" ||
          specifier.includes("scripts-bak") ||
          specifier.includes("tools/browser-client-recovery")
        ) {
          throw new Error(
            `Forbidden production import in ${relativeToWorkspace(fileName)}: ${specifier}`,
          );
        }
        const dependency = resolveRelativeTypeScriptImport(fileName, specifier);
        if (dependency != null) pending.push(dependency);
      }
    }
  }
  return [...visited].sort((left, right) => left.localeCompare(right));
}

function bunLogText(logs: readonly unknown[]): string {
  return logs
    .map((log) =>
      typeof log === "object" && log !== null && "message" in log
        ? String(log.message)
        : String(log),
    )
    .join("\n");
}

async function bundleEntry(entry: BuildEntry, index: number): Promise<string> {
  const entryOutputRoot = path.join(temporaryOutputRoot, `.entry-${index}`);
  await mkdir(entryOutputRoot, { recursive: true });
  const result = await Bun.build({
    entrypoints: [path.join(sourceRoot, entry.source)],
    outdir: entryOutputRoot,
    target: "node",
    format: "esm",
    splitting: false,
    sourcemap: "none",
    minify: false,
    packages: "external",
    external: [
      "./site-status-policy.mjs",
      "./node_modules/classic-level.mjs",
    ],
    naming: { entry: "entry.mjs" },
    root: sourceRoot,
  });
  if (!result.success) {
    throw new Error(
      `Bun.build failed for ${entry.output}:\n${bunLogText(result.logs)}`,
    );
  }
  const generatedPath = path.join(entryOutputRoot, "entry.mjs");
  const outputPath = path.join(temporaryOutputRoot, entry.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rename(generatedPath, outputPath);
  await rm(entryOutputRoot, { recursive: true, force: true });
  await chmod(outputPath, entry.mode);
  return outputPath;
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

async function treeDigest(root: string): Promise<{ fileCount: number; sha256: string }> {
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

async function copyRuntimeDependencies(): Promise<
  {
    packages: Array<{ name: string; version: string }>;
    signedAssets: Array<{ path: string; sha256: string }>;
  }
> {
  const destinationRoot = path.join(temporaryOutputRoot, "node_modules");
  await mkdir(destinationRoot, { recursive: true });
  const packages = [];
  for (const packageName of runtimeDependencyPackages) {
    const packageRoot = path.join(sourceRoot, "node_modules", packageName);
    const destination = path.join(destinationRoot, packageName);
    const packageJson = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    ) as unknown;
    if (
      typeof packageJson !== "object" ||
      packageJson === null ||
      !("version" in packageJson) ||
      typeof packageJson.version !== "string"
    ) {
      throw new Error(`Invalid installed package metadata: ${packageName}`);
    }
    await cp(packageRoot, destination, { recursive: true });
    packages.push({ name: packageName, version: packageJson.version });
  }
  const signedAssetRelativePath =
    "classic-level/prebuilds/darwin-x64+arm64/classic-level.node";
  const signedAssetSource = path.join(
    sourceRoot,
    "vendor/prebuilds",
    signedAssetRelativePath,
  );
  const signedAsset = await readFile(signedAssetSource);
  const signedAssetHash = sha256(signedAsset);
  const expectedSignedAssetHash =
    "e5555a5be604a47e4920bd93f8804ef33518aa1493e12709513f3bba7ee0096f";
  if (signedAssetHash !== expectedSignedAssetHash) {
    throw new Error(
      `Signed classic-level runtime asset drifted: ${signedAssetHash}.`,
    );
  }
  await copyFile(
    signedAssetSource,
    path.join(destinationRoot, signedAssetRelativePath),
  );
  return {
    packages,
    signedAssets: [
      { path: `node_modules/${signedAssetRelativePath}`, sha256: signedAssetHash },
    ],
  };
}

async function copyConfig(
  source: string,
  output: string,
  mode: 0o644,
): Promise<string> {
  const sourcePath = path.join(sourceRoot, source);
  const outputPath = path.join(temporaryOutputRoot, output);
  const parsed: unknown = JSON.parse(await readFile(sourcePath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`Configuration root must be an object: ${source}`);
  await copyFile(sourcePath, outputPath);
  await chmod(outputPath, mode);
  return outputPath;
}

async function fileRecord(
  filePath: string,
  source: string,
  classification: string,
): Promise<Record<string, unknown>> {
  const contents = await readFile(filePath);
  const metadata = await stat(filePath);
  return {
    output: path.basename(filePath),
    source,
    classification,
    bytes: contents.length,
    sha256: sha256(contents),
    mode: (metadata.mode & 0o777).toString(8).padStart(4, "0"),
  };
}

async function main(): Promise<void> {
  if (unexpectedArguments.length > 0) {
    throw new Error("Usage: bun run build [--utilities-only]");
  }
  if (Bun.version !== "1.2.20") {
    throw new Error(`Expected Bun 1.2.20, received ${Bun.version}.`);
  }

  const program = loadTypeScriptProgram();
  const productionFiles = assertCanonicalDependencyGraph(program, artifactEntries);

  await rm(temporaryOutputRoot, { recursive: true, force: true });
  await mkdir(temporaryOutputRoot, { recursive: true });

  const generatedPaths: string[] = [];
  const runtimeDependencies = await copyRuntimeDependencies();
  for (const [index, entry] of artifactEntries.entries()) {
    generatedPaths.push(await bundleEntry(entry, index));
  }
  for (const config of configEntries) {
    generatedPaths.push(
      await copyConfig(config.source, config.output, config.mode),
    );
  }
  const adapterRecords = [];
  for (const entry of runtimeAdapterEntries) {
    adapterRecords.push(
      await fileRecord(
        path.join(temporaryOutputRoot, entry.output),
        entry.source,
        entry.classification,
      ),
    );
  }

  const records = [];
  for (const entry of entries) {
    records.push(
      await fileRecord(
        path.join(temporaryOutputRoot, entry.output),
        entry.source,
        entry.classification,
      ),
    );
  }
  for (const config of configEntries) {
    records.push(
      await fileRecord(
        path.join(temporaryOutputRoot, config.output),
        config.source,
        config.classification,
      ),
    );
  }

  const actualOutputs = records
    .map((record) => String(record.output))
    .sort();
  const expectedOutputs = utilitiesOnly
    ? [
        ...utilityEntries.map((entry) => entry.output),
        ...configEntries.map((entry) => entry.output),
      ].sort()
    : expectedFirstPartyOutputs;
  if (JSON.stringify(actualOutputs) !== JSON.stringify(expectedOutputs)) {
    throw new Error("Build output inventory does not match the canonical mapping.");
  }

  const sourceHashes: Record<string, string> = {};
  for (const fileName of productionFiles) {
    sourceHashes[relativeToWorkspace(fileName)] = sha256(await readFile(fileName));
  }
  const manifest = {
    terminology:
      "semantic-equivalent source recovery / maintainable modular reconstruction",
    complete: !utilitiesOnly,
    packageManager: { name: "bun", version: Bun.version, lockfile: "bun.lock" },
    compiler: { name: "TypeScript", version: ts.version, strict: true },
    bundler: {
      name: "Bun.build",
      version: Bun.version,
      target: "node",
      format: "esm",
      splitting: false,
      minify: false,
      treeShaking: "bun-default",
      sourcemap: "none",
      packages: "external",
    },
    dependencyPolicy: {
      sourceRoot: relativeToWorkspace(sourceRoot),
      forbiddenRoots: [
        "components/codex-plugin/scripts-bak",
        "components/codex-plugin/scripts",
        "tools/browser-client-recovery",
      ],
      verifiedSourceFiles: productionFiles.map(relativeToWorkspace),
    },
    outputs: records,
    thirdParty: {
      packages: runtimeDependencies.packages,
      signedAssets: runtimeDependencies.signedAssets,
      adapterOutputs: adapterRecords,
      tree: await treeDigest(path.join(temporaryOutputRoot, "node_modules")),
    },
    sourceHashes,
  };
  await writeFile(
    path.join(temporaryOutputRoot, "build-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await rm(outputRoot, { recursive: true, force: true });
  await rename(temporaryOutputRoot, outputRoot);
  console.log(
    `Built ${generatedPaths.length} canonical artifacts into ${relativeToWorkspace(outputRoot)}.`,
  );
}

await main();
