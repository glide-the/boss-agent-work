#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, "..");
const marketplaceRoot = path.resolve(pluginRoot, "../..");
const identity = readJson(path.join(scriptDirectory, "standalone-identity.json"));
const failures = [];
const liveMode = process.argv.includes("--live");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function expectEqual(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectIncludes(label, source, value) {
  if (!source.includes(value)) failures.push(`${label}: missing ${JSON.stringify(value)}`);
}

function expectExcludes(label, source, value) {
  if (source.includes(value)) failures.push(`${label}: still contains ${JSON.stringify(value)}`);
}

function deriveChromeExtensionId(publicKey) {
  const digest = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex");
  return digest
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (character) => "abcdefghijklmnop"[Number.parseInt(character, 16)]);
}

const pluginManifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
const marketplaceManifestPath = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");
const marketplace = existsSync(marketplaceManifestPath)
  ? readJson(marketplaceManifestPath)
  : liveMode
    ? { name: identity.marketplaceName, plugins: [{ name: identity.pluginName }] }
    : null;
const extensionConfig = readJson(path.join(scriptDirectory, "extension-id.json"));
const extensionManifest = readJson(path.join(pluginRoot, "chrome-extension", "manifest.json"));
const installSource = readFileSync(path.join(scriptDirectory, "installManifest.mjs"), "utf8");
const backgroundSource = readFileSync(path.join(pluginRoot, "chrome-extension", "background.js"), "utf8");

expectEqual("plugin manifest name", pluginManifest.name, identity.pluginName);
expectEqual("plugin display name", pluginManifest.interface?.displayName, "Boss投递");
if (marketplace === null) {
  failures.push(`marketplace manifest is missing: ${marketplaceManifestPath}`);
} else {
  expectEqual("marketplace name", marketplace.name, identity.marketplaceName);
  expectEqual("marketplace plugin name", marketplace.plugins?.[0]?.name, identity.pluginName);
}
expectEqual("extension config ID", extensionConfig.extensionId, identity.extensionId);
expectEqual("extension config host", extensionConfig.extensionHostName, identity.extensionHostName);
expectEqual("manifest-derived extension ID", deriveChromeExtensionId(extensionManifest.key), identity.extensionId);
expectEqual("extension display name", extensionManifest.name, "Boss投递");
expectEqual("extension action title", extensionManifest.action?.default_title, "Boss投递");
expectEqual("extension update URL", extensionManifest.update_url, undefined);

expectIncludes("installer extension ID", installSource, identity.extensionId);
expectIncludes("installer host name", installSource, identity.extensionHostName);
expectIncludes("installer dev channel", installSource, 'channel: "dev"');
expectIncludes("installer runtime registry", installSource, 'chrome-native-hosts-v2.json');
for (const hostName of identity.extensionHostNames) {
  expectIncludes("extension background host", backgroundSource, hostName);
}

expectExcludes("installer extension isolation", installSource, "hehggadaopoacecdllhhajmbjkdcmajg");
expectExcludes("extension ID isolation", backgroundSource, "hehggadaopoacecdllhhajmbjkdcmajg");

const installerHostNames = installSource.match(/com\.openai\.codexextension(?:\.dev|\.internal)?/g) ?? [];
const extensionHostNames = backgroundSource.match(/com\.openai\.codexextension(?:\.dev|\.internal)?/g) ?? [];
for (const hostName of new Set([...installerHostNames, ...extensionHostNames])) {
  if (hostName !== identity.extensionHostName) failures.push(`unexpected native host name: ${hostName}`);
}

const currentBinary = path.join(
  pluginRoot,
  "extension-host",
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
  process.arch,
  process.platform === "win32" ? "extension-host.exe" : "extension-host",
);
if (!existsSync(currentBinary)) failures.push(`native host binary is unavailable for ${process.platform}/${process.arch}: ${currentBinary}`);

if (liveMode) {
  if (process.platform !== "darwin") {
    failures.push("--live currently supports the packaged macOS target only");
  } else {
    const liveManifestPath = path.join(
      homedir(),
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "NativeMessagingHosts",
      `${identity.extensionHostName}.json`,
    );
    if (!existsSync(liveManifestPath)) {
      failures.push(`live Native Messaging manifest is missing: ${liveManifestPath}`);
    } else {
      const liveManifest = readJson(liveManifestPath);
      expectEqual("live native host name", liveManifest.name, identity.extensionHostName);
      expectEqual(
        "live allowed origin",
        liveManifest.allowed_origins?.includes(`chrome-extension://${identity.extensionId}/`),
        true,
      );
      const liveHostPath = path.resolve(liveManifest.path);
      const installedPathFragment = path.join(
        "plugins",
        "cache",
        identity.marketplaceName,
        identity.pluginName,
      );
      if (liveHostPath !== path.resolve(currentBinary) && !liveHostPath.includes(installedPathFragment)) {
        failures.push(`live native host path is outside the standalone plugin: ${liveHostPath}`);
      }

      const codexHome = process.env.CODEX_HOME ?? path.join(homedir(), ".codex");
      const registryPath = path.join(codexHome, "chrome-native-hosts-v2.json");
      if (!existsSync(registryPath)) {
        failures.push(`live app-server registry is missing: ${registryPath}`);
      } else {
        const registry = readJson(registryPath);
        const matchingEntry = registry.entries?.find(
          (entry) =>
            entry.extensionIds?.includes(identity.extensionId) &&
            entry.nativeHostNames?.includes(identity.extensionHostName),
        );
        if (matchingEntry == null) {
          failures.push("live app-server registry has no matching standalone entry");
        } else {
          expectEqual("live registry proxy host", matchingEntry.proxyHost, identity.proxyHost);
          expectEqual("live registry plugin version", matchingEntry.appVersion, pluginManifest.version);
        }
      }
    }
  }
}

const result = {
  correct: failures.length === 0,
  pluginRoot,
  marketplaceRoot,
  extensionId: identity.extensionId,
  extensionHostName: identity.extensionHostName,
  failures,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.correct ? 0 : 1;
