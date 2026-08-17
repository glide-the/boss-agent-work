import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseManualInstallArguments,
  resolveManualInstallPlan,
} from "../src/manual-install-environment.mjs";

test("manual installer parses explicit paths and rejects unknown flags", () => {
  const parsed = parseManualInstallArguments([
    "--dry-run",
    "--json",
    "--codex-home",
    "/tmp/codex-home",
    "--node",
    "/tmp/node",
  ]);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.json, true);
  assert.equal(parsed.codexHome, "/tmp/codex-home");
  assert.equal(parsed.nodePath, "/tmp/node");
  assert.throws(() => parseManualInstallArguments(["--unknown"]), /Unknown argument/);
});

test("manual installer dry-run plan validates an isolated installed plugin and Runtime", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "boss-manual-plan-"));
  t.after(async () => await fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex-home");
  const resourcesPath = path.join(root, "resources");
  const versionRoot = path.join(
    codexHome,
    "plugins/cache/codex-chrome-automation-local/chrome-dev/26.707.30751-standalone.3",
  );
  const files = [
    path.join(versionRoot, ".codex-plugin", "plugin.json"),
    path.join(versionRoot, "scripts", "installManifest.mjs"),
    path.join(versionRoot, "extension-host", process.platform === "darwin" ? "macos" : "linux", process.arch, "extension-host"),
    path.join(resourcesPath, "codex"),
    path.join(resourcesPath, "node"),
    path.join(resourcesPath, "node_repl"),
  ];
  for (const filePath of files) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "fixture");
  }
  const plan = await resolveManualInstallPlan({ codexHome, homeDirectory: root, resourcesPath, versionRoot });
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.runtimePaths.codexCliPath, path.join(resourcesPath, "codex"));
});
