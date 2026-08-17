#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const toolDirectory = import.meta.dirname;
const workspaceRoot = path.resolve(toolDirectory, "../..");
const defaultInput = path.join(workspaceRoot, "components/codex-plugin/scripts/browser-client.mjs");
const defaultOutput = path.join(workspaceRoot, "recovery/browser-client/analysis");

function parseArguments(argv) {
  const result = { input: defaultInput, output: defaultOutput };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--input") result.input = path.resolve(argv[++index]);
    else if (argument === "--output") result.output = path.resolve(argv[++index]);
    else if (argument === "--help") {
      console.log("Usage: analyze-browser-client.mjs [--input FILE] [--output DIRECTORY]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function location(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.end);
  return {
    start: node.getStart(sourceFile),
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
    return name.elements.flatMap((element) => {
      if (!ts.isBindingElement(element)) return [];
      return declarationNames(element.name);
    });
  }
  return [];
}

function nodeName(node, sourceFile) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (node.name && ts.isPrivateIdentifier(node.name)) return node.name.text;
  if (node.name && ts.isStringLiteralLike(node.name)) return node.name.text;
  if (ts.isVariableDeclaration(node)) return declarationNames(node.name).join(",");
  return `<anonymous@${location(sourceFile, node).startLine}>`;
}

function calleeName(expression, sourceFile) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.getText(sourceFile).slice(0, 240);
  if (ts.isElementAccessExpression(expression)) return expression.getText(sourceFile).slice(0, 240);
  if (ts.isImportCall(expression)) return "import";
  return expression.getText(sourceFile).slice(0, 240);
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function classifyString(value) {
  const categories = [];
  if (/^https?:\/\//u.test(value)) categories.push("url");
  if (/^BROWSER_USE_[A-Z0-9_]+$/u.test(value) || /^NODE_REPL_[A-Z0-9_]+$/u.test(value)) categories.push("environment");
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}$/u.test(value)) categories.push("command-or-field");
  if (/^[A-Z][A-Z0-9_]{2,}$/u.test(value)) categories.push("protocol-or-enum");
  if (value === "2.0" || value.includes("jsonrpc")) categories.push("json-rpc");
  if (/Browser Use|browser security|permission|origin|upload|download|site status/iu.test(value)) categories.push("security-or-error");
  return categories;
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

function moduleCandidates(source, sourceFile) {
  const candidates = [
    ["process-shim", "const processShim", "confirmed", "Standalone Node REPL process compatibility shim."],
    ["statsig-sdk", "[Statsig]", "confirmed", "Inlined Statsig SDK; third-party code should remain isolated."],
    ["json-rpc", "No handler registered for method", "confirmed", "JSON-RPC endpoint and transport behavior."],
    ["browser-api-schema", "BrowserAuthHandoffCommand", "confirmed", "Command schemas and Browser/Tab API command table."],
    ["telemetry", "browser_use.command.execute", "confirmed", "Command tracing and telemetry wrapper."],
    ["site-status-policy", "__BossSiteStatusPolicy", "confirmed", "Project-specific local site_status policy adapter."],
    ["browser-security", "ensureUrlOriginConsentAllowed", "confirmed", "Navigation, origin, file-transfer and CDP authorization ordering."],
    ["clipboard-bridge", "Browser Use clipboard bridge", "confirmed", "Page/native clipboard bridge."],
    ["runtime-bridge", "browser_use_invocation_started", "confirmed", "setupBrowserRuntime bootstrap and Node REPL bridge."],
    ["public-entry", "setupBrowserRuntime", "confirmed", "Single public ESM export."],
  ];
  return candidates.map(([name, anchor, confidence, responsibility]) => {
    const offset = source.indexOf(anchor);
    if (offset < 0) return { name, anchor, confidence: "unresolved", responsibility, found: false };
    const point = sourceFile.getLineAndCharacterOfPosition(offset);
    return { name, anchor, confidence, responsibility, found: true, offset, line: point.line + 1 };
  });
}

function thirdPartyEvidence(source, sourceFile) {
  const signatures = [
    ["punycode", "2.3.1", "Version literal adjacent to punycode implementation."],
    ["Statsig JavaScript SDK", "3.32.6", "SDK_VERSION literal and Statsig log prefix."],
    ["Zod", "ZodError", "Runtime schema classes and error names."],
  ];
  return signatures.map(([packageName, anchor, evidence]) => {
    const offset = source.indexOf(anchor);
    if (offset < 0) return { packageName, anchor, found: false, confidence: "unresolved", evidence };
    const point = sourceFile.getLineAndCharacterOfPosition(offset);
    return { packageName, anchor, found: true, confidence: "confirmed", evidence, offset, line: point.line + 1 };
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const source = await readFile(options.input, "utf8");
  const sourceFile = ts.createSourceFile(
    options.input,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = sourceFile.parseDiagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    start: diagnostic.start,
    length: diagnostic.length,
  }));
  if (parseDiagnostics.length > 0) {
    throw new Error(`AST parse failed: ${JSON.stringify(parseDiagnostics[0])}`);
  }

  const imports = [];
  const exports = [];
  const topLevelDeclarations = [];
  const functions = [];
  const classes = [];
  const strings = [];
  const calls = [];
  const functionStack = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      imports.push({
        specifier: statement.moduleSpecifier.text,
        clause: statement.importClause?.getText(sourceFile) ?? null,
        ...location(sourceFile, statement),
      });
    }
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          exports.push({ exported: element.name.text, local: element.propertyName?.text ?? element.name.text, ...location(sourceFile, element) });
        }
      } else {
        exports.push({ exported: "*", local: null, ...location(sourceFile, statement) });
      }
    }
    if (ts.isFunctionDeclaration(statement)) {
      const name = nodeName(statement, sourceFile);
      topLevelDeclarations.push({ kind: "function", name, exported: hasExportModifier(statement), ...location(sourceFile, statement) });
      if (hasExportModifier(statement)) exports.push({ exported: name, local: name, ...location(sourceFile, statement) });
    } else if (ts.isClassDeclaration(statement)) {
      const name = nodeName(statement, sourceFile);
      topLevelDeclarations.push({ kind: "class", name, exported: hasExportModifier(statement), ...location(sourceFile, statement) });
      if (hasExportModifier(statement)) exports.push({ exported: name, local: name, ...location(sourceFile, statement) });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of declarationNames(declaration.name)) {
          topLevelDeclarations.push({ kind: "variable", name, exported: hasExportModifier(statement), ...location(sourceFile, declaration) });
          if (hasExportModifier(statement)) exports.push({ exported: name, local: name, ...location(sourceFile, declaration) });
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
        name,
        async: node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true,
        parameters: node.parameters?.map((parameter) => parameter.name.getText(sourceFile)) ?? [],
        ...location(sourceFile, node),
      });
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      classes.push({
        name: nodeName(node, sourceFile),
        methods: node.members
          .filter((member) => ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member))
          .map((member) => nodeName(member, sourceFile)),
        ...location(sourceFile, node),
      });
    }
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const categories = classifyString(node.text);
      if (categories.length > 0) strings.push({ value: node.text, categories, ...location(sourceFile, node) });
    }
    if (ts.isCallExpression(node)) {
      calls.push({
        caller: functionStack.at(-1) ?? "<top-level>",
        callee: calleeName(node.expression, sourceFile),
        argumentCount: node.arguments.length,
        ...location(sourceFile, node),
      });
    }
    ts.forEachChild(node, visit);
    if (functionLike) functionStack.pop();
  }
  visit(sourceFile);

  const sourceMapMarkers = ["sourceMappingURL", "sourcesContent", "webpack://", "vite://"]
    .filter((marker) => source.includes(marker));
  const fingerprint = {
    input: path.relative(workspaceRoot, options.input),
    bytes: Buffer.byteLength(source),
    sha256: sha256(source),
    lineCount: source.split("\n").length,
    parser: { name: "TypeScript Compiler API", version: ts.version, parseDiagnostics },
    moduleSystem: "Node ESM with inlined CommonJS compatibility helpers",
    likelyBundler: {
      name: "esbuild",
      confidence: "inferred",
      evidence: ["Object.create/Object.defineProperty helper prelude", "lazy CommonJS wrapper shape", "single-file minified ESM output"],
    },
    sourceMaps: { markers: sourceMapMarkers, present: sourceMapMarkers.length > 0 },
    counts: {
      imports: imports.length,
      exports: exports.length,
      topLevelDeclarations: topLevelDeclarations.length,
      functions: functions.length,
      classes: classes.length,
      indexedStrings: strings.length,
      calls: calls.length,
    },
  };
  const inventory = {
    imports,
    exports: deduplicate(exports, (entry) => `${entry.exported}:${entry.local}`),
    topLevelDeclarations,
    functions,
    classes,
  };
  const protocolIndex = deduplicate(strings, (entry) => `${entry.value}:${entry.categories.join(",")}`);
  const callGraph = {
    edges: deduplicate(calls, (entry) => `${entry.caller}->${entry.callee}`),
    note: "Static syntactic calls only; dynamic dispatch, proxy calls, and transport messages require runtime differential tests.",
  };
  const boundaries = {
    moduleCandidates: moduleCandidates(source, sourceFile),
    thirdPartyEvidence: thirdPartyEvidence(source, sourceFile),
  };

  await mkdir(options.output, { recursive: true });
  await Promise.all([
    writeFile(path.join(options.output, "bundle-fingerprint.json"), `${JSON.stringify(fingerprint, null, 2)}\n`),
    writeFile(path.join(options.output, "ast-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`),
    writeFile(path.join(options.output, "protocol-string-index.json"), `${JSON.stringify(protocolIndex, null, 2)}\n`),
    writeFile(path.join(options.output, "call-graph.json"), `${JSON.stringify(callGraph, null, 2)}\n`),
    writeFile(path.join(options.output, "module-boundaries.json"), `${JSON.stringify(boundaries, null, 2)}\n`),
  ]);
  console.log(`Analyzed ${options.input}`);
  console.log(`Wrote AST evidence to ${options.output}`);
}

await main();
