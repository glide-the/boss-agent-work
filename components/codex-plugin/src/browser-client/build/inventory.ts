export interface BuildEntry {
  source: string;
  output: string;
  mode: 0o644 | 0o755;
  classification:
    | "browser-runtime"
    | "first-party-cli"
    | "first-party-module"
    | "third-party-adapter";
}

export interface ConfigEntry {
  source: string;
  output: string;
  mode: 0o644;
  classification: "identity-config";
}

export const browserRuntimeEntry: BuildEntry = {
  source: "index.ts",
  output: "browser-client.mjs",
  mode: 0o644,
  classification: "browser-runtime",
};

export const utilityEntries: BuildEntry[] = [
  {
    source: "scripts/check-extension-installed.ts",
    output: "check-extension-installed.js",
    mode: 0o755,
    classification: "first-party-cli",
  },
  {
    source: "scripts/check-native-host-manifest.ts",
    output: "check-native-host-manifest.js",
    mode: 0o644,
    classification: "first-party-cli",
  },
  {
    source: "scripts/chrome-is-running.ts",
    output: "chrome-is-running.js",
    mode: 0o755,
    classification: "first-party-cli",
  },
  {
    source: "scripts/installed-browsers.ts",
    output: "installed-browsers.js",
    mode: 0o644,
    classification: "first-party-cli",
  },
  {
    source: "scripts/install-manifest.ts",
    output: "installManifest.mjs",
    mode: 0o644,
    classification: "first-party-module",
  },
  {
    source: "scripts/open-chrome-window.ts",
    output: "open-chrome-window.js",
    mode: 0o755,
    classification: "first-party-cli",
  },
  {
    source: "scripts/patch-browser-client-site-status.ts",
    output: "patch-browser-client-site-status.mjs",
    mode: 0o644,
    classification: "first-party-module",
  },
  {
    source: "security/site-status-policy.ts",
    output: "site-status-policy.mjs",
    mode: 0o644,
    classification: "first-party-module",
  },
  {
    source: "scripts/verify-standalone.ts",
    output: "verify-standalone.mjs",
    mode: 0o755,
    classification: "first-party-cli",
  },
];

export const configEntries: ConfigEntry[] = [
  {
    source: "config/extension-id.json",
    output: "extension-id.json",
    mode: 0o644,
    classification: "identity-config",
  },
  {
    source: "config/standalone-identity.json",
    output: "standalone-identity.json",
    mode: 0o644,
    classification: "identity-config",
  },
];

export const allBuildEntries: BuildEntry[] = [browserRuntimeEntry, ...utilityEntries];

export const runtimeAdapterEntries: BuildEntry[] = [
  {
    source: "vendor/classic-level-adapter.ts",
    output: "node_modules/classic-level.mjs",
    mode: 0o644,
    classification: "third-party-adapter",
  },
];

export const runtimeDependencyPackages = [
  "abstract-level",
  "classic-level",
  "is-buffer",
  "level-supports",
  "level-transcoder",
  "maybe-combine-errors",
  "module-error",
  "napi-macros",
  "node-gyp-build",
] as const;

export const expectedFirstPartyOutputs = [
  ...allBuildEntries.map((entry) => entry.output),
  ...configEntries.map((entry) => entry.output),
].sort();
