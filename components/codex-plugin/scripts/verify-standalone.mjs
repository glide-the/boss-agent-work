#!/usr/bin/env node

// scripts/verify-standalone.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
function objectRecord(value) {
  return typeof value === "object" && value !== null ? value : null;
}
function nestedRecord(value, property) {
  return objectRecord(objectRecord(value)?.[property]);
}
function readJson(filePath) {
  const parsed = objectRecord(JSON.parse(readFileSync(filePath, "utf8")));
  if (parsed == null)
    throw new Error(`Expected a JSON object in ${filePath}.`);
  return parsed;
}
function readIdentity(filePath) {
  const parsed = readJson(filePath);
  const extensionHostNames = parsed.extensionHostNames;
  if (typeof parsed.extensionHostName !== "string" || !Array.isArray(extensionHostNames) || !extensionHostNames.every((value) => typeof value === "string") || typeof parsed.extensionId !== "string" || typeof parsed.marketplaceName !== "string" || typeof parsed.pluginName !== "string" || typeof parsed.proxyHost !== "string") {
    throw new Error(`Invalid standalone identity: ${filePath}`);
  }
  return {
    extensionHostName: parsed.extensionHostName,
    extensionHostNames,
    extensionId: parsed.extensionId,
    marketplaceName: parsed.marketplaceName,
    pluginName: parsed.pluginName,
    proxyHost: parsed.proxyHost
  };
}
function deriveChromeExtensionId(publicKey) {
  const digest = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex");
  return digest.slice(0, 32).replace(/[0-9a-f]/gu, (character) => "abcdefghijklmnop"[Number.parseInt(character, 16)]);
}
function verifyStandalone({
  arguments_: argumentsOverride = process.argv.slice(2),
  scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
} = {}) {
  const pluginRoot = path.resolve(scriptDirectory, "..");
  const marketplaceRoot = path.resolve(pluginRoot, "../..");
  const identity = readIdentity(path.join(scriptDirectory, "standalone-identity.json"));
  const failures = [];
  const liveMode = argumentsOverride.includes("--live");
  const expectEqual = (label, actual, expected) => {
    if (actual !== expected) {
      failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };
  const expectIncludes = (label, source, value) => {
    if (!source.includes(value))
      failures.push(`${label}: missing ${JSON.stringify(value)}`);
  };
  const expectExcludes = (label, source, value) => {
    if (source.includes(value))
      failures.push(`${label}: still contains ${JSON.stringify(value)}`);
  };
  const pluginManifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  const marketplaceManifestPath = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");
  const marketplace = existsSync(marketplaceManifestPath) ? readJson(marketplaceManifestPath) : liveMode ? { name: identity.marketplaceName, plugins: [{ name: identity.pluginName }] } : null;
  const extensionConfig = readJson(path.join(scriptDirectory, "extension-id.json"));
  const extensionManifest = readJson(path.join(pluginRoot, "chrome-extension", "manifest.json"));
  const installSource = readFileSync(path.join(scriptDirectory, "installManifest.mjs"), "utf8");
  const browserClientSource = readFileSync(path.join(scriptDirectory, "browser-client.mjs"), "utf8");
  const siteStatusPolicySource = readFileSync(path.join(scriptDirectory, "site-status-policy.mjs"), "utf8");
  const backgroundSource = readFileSync(path.join(pluginRoot, "chrome-extension", "background.js"), "utf8");
  expectEqual("plugin manifest name", pluginManifest.name, identity.pluginName);
  expectEqual("plugin display name", nestedRecord(pluginManifest, "interface")?.displayName, "Boss投递");
  if (marketplace === null) {
    failures.push(`marketplace manifest is missing: ${marketplaceManifestPath}`);
  } else {
    expectEqual("marketplace name", marketplace.name, identity.marketplaceName);
    const plugins = marketplace.plugins;
    expectEqual("marketplace plugin name", Array.isArray(plugins) ? objectRecord(plugins[0])?.name : undefined, identity.pluginName);
  }
  expectEqual("extension config ID", extensionConfig.extensionId, identity.extensionId);
  expectEqual("extension config host", extensionConfig.extensionHostName, identity.extensionHostName);
  const extensionKey = extensionManifest.key;
  expectEqual("manifest-derived extension ID", typeof extensionKey === "string" ? deriveChromeExtensionId(extensionKey) : undefined, identity.extensionId);
  expectEqual("extension display name", extensionManifest.name, "Boss投递");
  expectEqual("extension action title", nestedRecord(extensionManifest, "action")?.default_title, "Boss投递");
  expectEqual("extension update URL", extensionManifest.update_url, undefined);
  expectIncludes("installer extension ID", installSource, identity.extensionId);
  expectIncludes("installer host name", installSource, identity.extensionHostName);
  expectIncludes("installer dev channel", installSource, 'channel: "dev"');
  expectIncludes("installer runtime registry", installSource, "chrome-native-hosts-v2.json");
  for (const hostName of identity.extensionHostNames) {
    expectIncludes("extension background host", backgroundSource, hostName);
  }
  expectExcludes("installer extension isolation", installSource, "hehggadaopoacecdllhhajmbjkdcmajg");
  expectExcludes("extension ID isolation", backgroundSource, "hehggadaopoacecdllhhajmbjkdcmajg");
  expectIncludes("site status policy import", browserClientSource, 'from "./site-status-policy.mjs"');
  expectIncludes("site status policy integration", browserClientSource, "new __BossSiteStatusPolicy");
  expectIncludes("site status policy call", browserClientSource, ".throwIfBlocksUrl(");
  expectExcludes("remote site status base", browserClientSource, 'var s6="https://chatgpt.com/backend-api",a6="agent";');
  expectIncludes("site status default-off switch", siteStatusPolicySource, "BROWSER_USE_SITE_STATUS_CHECK_ENABLED");
  expectIncludes("site status local base switch", siteStatusPolicySource, "BROWSER_USE_SITE_STATUS_BASE_URL");
  expectIncludes("origin authorization remains", browserClientSource, "ensureUrlOriginConsentAllowed");
  expectIncludes("file authorization remains", browserClientSource, "ensureCurrentTabFileTransferAllowed");
  const installerHostNames = installSource.match(/com\.openai\.codexextension(?:\.dev|\.internal)?/gu) ?? [];
  const extensionHostNames = backgroundSource.match(/com\.openai\.codexextension(?:\.dev|\.internal)?/gu) ?? [];
  for (const hostName of new Set(installerHostNames)) {
    if (hostName !== identity.extensionHostName)
      failures.push(`unexpected installer native host name: ${hostName}`);
  }
  const extensionHasChannelMap = extensionHostNames.includes("com.openai.codexextension") && extensionHostNames.includes("com.openai.codexextension.internal") && backgroundSource.includes(`dev:\`${identity.extensionHostName}\``) && backgroundSource.includes(".dev,{onStatusChange:");
  for (const hostName of new Set(extensionHostNames)) {
    if (hostName !== identity.extensionHostName && !extensionHasChannelMap) {
      failures.push(`unexpected active extension native host name: ${hostName}`);
    }
  }
  const currentBinary = path.join(pluginRoot, "extension-host", process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux", process.arch, process.platform === "win32" ? "extension-host.exe" : "extension-host");
  if (!existsSync(currentBinary)) {
    failures.push(`native host binary is unavailable for ${process.platform}/${process.arch}: ${currentBinary}`);
  }
  if (liveMode) {
    if (process.platform !== "darwin") {
      failures.push("--live currently supports the packaged macOS target only");
    } else {
      const liveManifestPath = path.join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", `${identity.extensionHostName}.json`);
      if (!existsSync(liveManifestPath)) {
        failures.push(`live Native Messaging manifest is missing: ${liveManifestPath}`);
      } else {
        const liveManifest = readJson(liveManifestPath);
        expectEqual("live native host name", liveManifest.name, identity.extensionHostName);
        const origins = liveManifest.allowed_origins;
        expectEqual("live allowed origin", Array.isArray(origins) && origins.includes(`chrome-extension://${identity.extensionId}/`), true);
        const manifestHostPath = liveManifest.path;
        const liveHostPath = path.resolve(typeof manifestHostPath === "string" ? manifestHostPath : "");
        const installedPathFragment = path.join("plugins", "cache", identity.marketplaceName, identity.pluginName);
        if (liveHostPath !== path.resolve(currentBinary) && !liveHostPath.includes(installedPathFragment)) {
          failures.push(`live native host path is outside the standalone plugin: ${liveHostPath}`);
        }
        const codexHome = process.env.CODEX_HOME ?? path.join(homedir(), ".codex");
        const registryPath = path.join(codexHome, "chrome-native-hosts-v2.json");
        if (!existsSync(registryPath)) {
          failures.push(`live app-server registry is missing: ${registryPath}`);
        } else {
          const registry = readJson(registryPath);
          const entries = registry.entries;
          const matchingEntry = Array.isArray(entries) ? entries.map(objectRecord).find((entry) => {
            const extensionIds = entry?.extensionIds;
            const nativeHostNames = entry?.nativeHostNames;
            return Array.isArray(extensionIds) && extensionIds.includes(identity.extensionId) && Array.isArray(nativeHostNames) && nativeHostNames.includes(identity.extensionHostName);
          }) : undefined;
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
  return {
    correct: failures.length === 0,
    pluginRoot,
    marketplaceRoot,
    extensionId: identity.extensionId,
    extensionHostName: identity.extensionHostName,
    failures
  };
}
var result = verifyStandalone();
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.correct ? 0 : 1;
export {
  verifyStandalone,
  deriveChromeExtensionId
};
