#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const scriptDirectory = import.meta.dirname;
export const reconstructionRoot = path.resolve(scriptDirectory, "..");
export const workspaceRoot = path.resolve(scriptDirectory, "../../../..");
export const defaultInputRoot = path.join(workspaceRoot, "components/codex-plugin/scripts-bak");
export const defaultOutputRoot = path.join(reconstructionRoot, "artifacts");

export const generatedArtifactNames = Object.freeze([
  "ast-inventory.json",
  "call-graph.json",
  "classes.csv",
  "declarations.csv",
  "exports.json",
  "file-inventory.csv",
  "functions.csv",
  "imports.json",
  "js-file-metrics.csv",
  "protocol-strings.csv",
  "reconstruction-summary.json",
  "security-call-graph.json",
  "sourcemap-check.json",
  "third-party-boundaries.json",
]);

function parseArguments(argv) {
  const result = { input: defaultInputRoot, output: defaultOutputRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--input" && value) {
      result.input = path.resolve(value);
      index += 1;
    } else if (argument === "--output" && value) {
      result.output = path.resolve(value);
      index += 1;
    } else if (argument === "--help") {
      console.log("Usage: extract-ast.mjs [--input DIRECTORY] [--output DIRECTORY]");
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  return result;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function regularFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await regularFiles(root, filePath));
    else if (entry.isFile()) files.push(filePath);
  }
  return files.sort((left, right) => path.relative(root, left).localeCompare(path.relative(root, right)));
}

export async function treeDigest(root) {
  const files = await regularFiles(root);
  const hash = createHash("sha256");
  for (const fileName of files) {
    hash.update(path.relative(root, fileName));
    hash.update("\0");
    hash.update(await readFile(fileName));
    hash.update("\0");
  }
  return { fileCount: files.length, sha256: hash.digest("hex") };
}

function csvCell(value) {
  const text = value == null ? "" : Array.isArray(value) ? value.join(";") : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeCsv(fileName, columns, rows) {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  await writeFile(fileName, `${lines.join("\n")}\n`);
}

async function writeJson(fileName, value) {
  await writeFile(fileName, `${JSON.stringify(value, null, 2)}\n`);
}

function nodeLocation(sourceFile, node) {
  const startOffset = node.getStart(sourceFile);
  const start = sourceFile.getLineAndCharacterOfPosition(startOffset);
  const end = sourceFile.getLineAndCharacterOfPosition(node.end);
  return {
    start: startOffset,
    end: node.end,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function declarationNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) => ts.isBindingElement(element) ? declarationNames(element.name) : []);
  }
  return [];
}

function nodeName(node, sourceFile) {
  if (node.name && (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name) || ts.isStringLiteralLike(node.name))) {
    return node.name.text;
  }
  if (ts.isVariableDeclaration(node)) return declarationNames(node.name).join(",");
  return `<anonymous@${nodeLocation(sourceFile, node).startLine}>`;
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function classifyString(value) {
  const categories = [];
  if (/^https?:\/\//u.test(value)) categories.push("url");
  if (/^(?:BROWSER_USE|NODE_REPL|CODEX|CHROME)_[A-Z0-9_]+$/u.test(value)) categories.push("environment");
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}$/u.test(value)) categories.push("command-or-field");
  if (/^[A-Z][A-Z0-9_]{2,}$/u.test(value)) categories.push("protocol-or-enum");
  if (value === "2.0" || value.includes("jsonrpc")) categories.push("json-rpc");
  if (/Browser Use|browser security|permission|origin|upload|download|file transfer|site.?status|clipboard|CDP/iu.test(value)) {
    categories.push("security-or-error");
  }
  return categories;
}

function calleeName(expression, sourceFile) {
  const text = expression.getText(sourceFile);
  return text.length <= 240 ? text : `${text.slice(0, 237)}...`;
}

function deduplicate(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function analyzeSource(fileName, logicalPath, source) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const diagnostics = sourceFile.parseDiagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    start: diagnostic.start ?? null,
    length: diagnostic.length ?? null,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
  if (diagnostics.length > 0) throw new Error(`AST parse failed for ${logicalPath}: ${diagnostics[0].message}`);

  const imports = [];
  const exports = [];
  const declarations = [];
  const functions = [];
  const classes = [];
  const protocolStrings = [];
  const calls = [];
  const functionStack = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      imports.push({
        file: logicalPath,
        specifier: statement.moduleSpecifier.text,
        clause: statement.importClause?.getText(sourceFile) ?? null,
        ...nodeLocation(sourceFile, statement),
      });
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          exports.push({
            file: logicalPath,
            exported: element.name.text,
            local: element.propertyName?.text ?? element.name.text,
            ...nodeLocation(sourceFile, element),
          });
        }
      } else {
        exports.push({ file: logicalPath, exported: "*", local: null, ...nodeLocation(sourceFile, statement) });
      }
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      const kind = ts.isFunctionDeclaration(statement) ? "function" : "class";
      const name = nodeName(statement, sourceFile);
      declarations.push({ file: logicalPath, kind, name, exported: hasExportModifier(statement), ...nodeLocation(sourceFile, statement) });
      if (hasExportModifier(statement)) exports.push({ file: logicalPath, exported: name, local: name, ...nodeLocation(sourceFile, statement) });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of declarationNames(declaration.name)) {
          declarations.push({ file: logicalPath, kind: "variable", name, exported: hasExportModifier(statement), ...nodeLocation(sourceFile, declaration) });
          if (hasExportModifier(statement)) exports.push({ file: logicalPath, exported: name, local: name, ...nodeLocation(sourceFile, declaration) });
        }
      }
    }
  }

  function visit(node) {
    const functionLike = ts.isFunctionLike(node);
    if (functionLike) {
      const name = nodeName(node, sourceFile);
      functionStack.push(name);
      functions.push({
        file: logicalPath,
        name,
        async: node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true,
        parameters: node.parameters?.map((parameter) => parameter.name.getText(sourceFile)) ?? [],
        ...nodeLocation(sourceFile, node),
      });
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      classes.push({
        file: logicalPath,
        name: nodeName(node, sourceFile),
        methods: node.members
          .filter((member) => ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member))
          .map((member) => nodeName(member, sourceFile)),
        ...nodeLocation(sourceFile, node),
      });
    }
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const categories = classifyString(node.text);
      if (categories.length > 0) {
        protocolStrings.push({
          file: logicalPath,
          value: node.text.length <= 1000 ? node.text : `${node.text.slice(0, 997)}...`,
          categories,
          ...nodeLocation(sourceFile, node),
        });
      }
    }
    if (ts.isCallExpression(node)) {
      calls.push({
        file: logicalPath,
        caller: functionStack.at(-1) ?? "<top-level>",
        callee: calleeName(node.expression, sourceFile),
        argumentCount: node.arguments.length,
        ...nodeLocation(sourceFile, node),
      });
    }
    ts.forEachChild(node, visit);
    if (functionLike) functionStack.pop();
  }
  visit(sourceFile);

  return { classes, calls, declarations, diagnostics, exports, functions, imports, protocolStrings };
}

async function thirdPartyBoundaries(inputRoot) {
  const nodeModulesRoot = path.join(inputRoot, "node_modules");
  const packages = [];
  for (const entry of await readdir(nodeModulesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(nodeModulesRoot, entry.name, "package.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      packages.push({ name: manifest.name ?? entry.name, version: manifest.version ?? null, license: manifest.license ?? null });
    } catch {
      packages.push({ name: entry.name, version: null, license: null });
    }
  }
  return {
    adapter: "node_modules/classic-level.mjs",
    packages: packages.sort((left, right) => left.name.localeCompare(right.name)),
    inlinedSignatures: [
      { packageName: "punycode", version: "2.3.1", classification: "confirmed" },
      { packageName: "Statsig JavaScript SDK", version: "3.32.6", classification: "confirmed" },
      { packageName: "Zod", version: null, classification: "confirmed-package-unresolved-version" },
    ],
  };
}

export async function extractArtifacts({ inputRoot = defaultInputRoot, outputRoot = defaultOutputRoot } = {}) {
  const allFiles = await regularFiles(inputRoot);
  const inventory = [];
  for (const fileName of allFiles) {
    const contents = await readFile(fileName);
    inventory.push({ path: path.relative(inputRoot, fileName), bytes: contents.length, sha256: sha256(contents) });
  }

  const topLevelScripts = allFiles.filter((fileName) => {
    const relative = path.relative(inputRoot, fileName);
    return !relative.includes(path.sep) && /\.(?:mjs|js)$/u.test(relative);
  });
  const metrics = [];
  const combined = { classes: [], calls: [], declarations: [], exports: [], functions: [], imports: [], protocolStrings: [] };
  const sourceMapHits = [];
  const mapFiles = allFiles.filter((fileName) => fileName.endsWith(".map")).map((fileName) => path.relative(inputRoot, fileName));

  for (const fileName of topLevelScripts) {
    const source = await readFile(fileName, "utf8");
    const logicalPath = path.relative(workspaceRoot, fileName);
    const result = analyzeSource(fileName, logicalPath, source);
    metrics.push({
      path: path.relative(inputRoot, fileName),
      bytes: Buffer.byteLength(source),
      lines: source.split("\n").length,
      parseDiagnostics: result.diagnostics.length,
      sha256: sha256(source),
    });
    for (const key of Object.keys(combined)) combined[key].push(...result[key]);
    for (const marker of ["sourceMappingURL", "sourcesContent", "webpack://", "vite://"]) {
      if (source.includes(marker)) sourceMapHits.push({ file: path.relative(inputRoot, fileName), marker });
    }
  }

  const tree = await treeDigest(inputRoot);
  const browserClient = metrics.find((entry) => entry.path === "browser-client.mjs");
  const calls = deduplicate(combined.calls, (entry) => `${entry.file}:${entry.caller}->${entry.callee}:${entry.start}`);
  const securityPattern = /security|origin|upload|download|file|site.?status|clipboard|cdp|permission/iu;
  const securityCalls = calls.filter((entry) => securityPattern.test(`${entry.caller} ${entry.callee}`));
  const securityStrings = combined.protocolStrings.filter((entry) => entry.categories.includes("security-or-error"));
  const summary = {
    terminology: "semantic-equivalent source recovery / maintainable modular reconstruction",
    input: path.relative(workspaceRoot, inputRoot),
    tree,
    browserClient,
    parser: { name: "TypeScript Compiler API", version: ts.version, scriptKind: "JS", target: "ESNext" },
    sourceMapsPresent: mapFiles.length > 0 || sourceMapHits.length > 0,
    counts: {
      topLevelScripts: topLevelScripts.length,
      imports: combined.imports.length,
      exports: combined.exports.length,
      declarations: combined.declarations.length,
      functions: combined.functions.length,
      classes: combined.classes.length,
      protocolStrings: combined.protocolStrings.length,
      calls: calls.length,
      securityCalls: securityCalls.length,
    },
  };

  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeCsv(path.join(outputRoot, "file-inventory.csv"), ["path", "bytes", "sha256"], inventory),
    writeCsv(path.join(outputRoot, "js-file-metrics.csv"), ["path", "bytes", "lines", "parseDiagnostics", "sha256"], metrics),
    writeCsv(path.join(outputRoot, "declarations.csv"), ["file", "kind", "name", "exported", "start", "end", "startLine", "startColumn"], combined.declarations),
    writeCsv(path.join(outputRoot, "functions.csv"), ["file", "name", "async", "parameters", "start", "end", "startLine", "startColumn"], combined.functions),
    writeCsv(path.join(outputRoot, "classes.csv"), ["file", "name", "methods", "start", "end", "startLine", "startColumn"], combined.classes),
    writeCsv(path.join(outputRoot, "protocol-strings.csv"), ["file", "value", "categories", "start", "end", "startLine", "startColumn"], combined.protocolStrings),
    writeJson(path.join(outputRoot, "imports.json"), combined.imports),
    writeJson(path.join(outputRoot, "exports.json"), deduplicate(combined.exports, (entry) => `${entry.file}:${entry.exported}:${entry.local}:${entry.start}`)),
    writeJson(path.join(outputRoot, "ast-inventory.json"), { metrics, counts: summary.counts }),
    writeJson(path.join(outputRoot, "call-graph.json"), { note: "Static syntactic calls only.", edges: calls }),
    writeJson(path.join(outputRoot, "security-call-graph.json"), { note: "Static candidates; ordering requires differential tests.", calls: securityCalls, strings: securityStrings }),
    writeJson(path.join(outputRoot, "sourcemap-check.json"), {
      mapFiles,
      markers: sourceMapHits,
      present: summary.sourceMapsPresent,
      conclusion: summary.sourceMapsPresent
        ? "Source Map evidence exists; inspect before semantic reconstruction."
        : "No Source Map evidence; exact author source cannot be claimed.",
    }),
    writeJson(path.join(outputRoot, "third-party-boundaries.json"), await thirdPartyBoundaries(inputRoot)),
    writeJson(path.join(outputRoot, "reconstruction-summary.json"), summary),
  ]);
  return summary;
}

if (import.meta.main) {
  const options = parseArguments(process.argv.slice(2));
  const summary = await extractArtifacts({ inputRoot: options.input, outputRoot: options.output });
  console.log(JSON.stringify(summary, null, 2));
}
