// Apply the three functional fixes for the 30s-per-command / stuck-command
// problems. Idempotent; every edit is anchor-verified and backed up first.
//
//   node apply-latency-fixes.js [--client <path>] [--ext-dir <path>] [--origins a,b] [--no-config]
//
// Fixes:
//  1. browser-client.mjs: Ly() defaults to "disabled-for-local-testing"
//     (skips per-command site_status network check + origin elicitation).
//  2. extension background.js: cn() always performs a real
//     chrome.debugger.attach (self-heals stale "attached" state).
//  3. <CODEX_HOME>/browser/config.toml: create global origin approvals.
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

const CLIENT = opt(
  "--client",
  "/Users/dmeck/.codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs",
);
const ORIGINS = opt("--origins", "https://www.zhipin.com,https://example.com").split(",");
const WRITE_CONFIG = !args.includes("--no-config");
const CODEX_HOME = process.env.CODEX_HOME || "/Users/dmeck/.codex";

function findExtensionDir() {
  const given = opt("--ext-dir", null);
  const candidates = given
    ? [given]
    : [
        "/Users/dmeck/project/CodexChromePlug/codex-1.1.5_0/1.1.5_0",
        ...safeReaddir("/Users/dmeck/project/CodexChromePlug").map((d) =>
          join("/Users/dmeck/project/CodexChromePlug", d),
        ),
      ];
  for (const dir of candidates.flatMap((d) => [d, join(d, "1.1.5_0")])) {
    try {
      const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      if (m.name === "Codex" && existsSync(join(dir, "background.js"))) return dir;
    } catch {}
  }
  return null;
}
const safeReaddir = (d) => {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
};

function patchOnce(file, name, oldStr, newStr, backupSuffix) {
  let src = readFileSync(file, "utf8");
  if (src.includes(newStr)) {
    console.log(`skip (already applied): ${name}`);
    return;
  }
  const count = src.split(oldStr).length - 1;
  if (count !== 1) {
    console.error(`ABORT: anchor "${name}" matched ${count}x in ${file}`);
    process.exit(1);
  }
  const bak = `${file}${backupSuffix}`;
  if (!existsSync(bak)) copyFileSync(file, bak);
  writeFileSync(file, src.replace(oldStr, newStr));
  console.log(`patched: ${name}`);
}

const syntaxCheck = (file) => {
  execFileSync(process.execPath, ["--check", file]);
  console.log(`syntax ok: ${file}`);
};

// 1. client security-mode default
patchOnce(
  CLIENT,
  "client Ly() security default",
  "function Ly(){return ap(Ay)}",
  'function Ly(){return ap(Ay)??"disabled-for-local-testing"}',
  ".bak-latency-fix",
);
syntaxCheck(CLIENT);

// 2. extension always-attach
const extDir = findExtensionDir();
if (!extDir) {
  console.error("ABORT: extension dir not found (pass --ext-dir)");
  process.exit(1);
}
const BG = join(extDir, "background.js");
patchOnce(
  BG,
  "extension cn() always-attach",
  'async function cn(t){await xt(t,async()=>{if(!se.has(t)){try{await chrome.debugger.attach({tabId:t},"1.3")}catch(e){if(!Ma(e))throw e}await un(t),se.add(t)}})}',
  'async function cn(t){await xt(t,async()=>{try{await chrome.debugger.attach({tabId:t},"1.3")}catch(e){if(!Ma(e))throw e}await un(t),se.add(t)})}',
  ".bak-latency-fix",
);
syntaxCheck(BG);

// 3. global origin approvals
if (WRITE_CONFIG) {
  const cfg = join(CODEX_HOME, "browser", "config.toml");
  if (existsSync(cfg)) {
    console.log(`skip (exists): ${cfg}`);
  } else {
    const body = `full_cdp_access_enabled = true\n\n[origins]\nallowed = [${ORIGINS.map((o) => `"${o}"`).join(", ")}]\ndenied = []\n`;
    writeFileSync(cfg, body);
    console.log(`wrote: ${cfg}`);
  }
}

console.log("\nDone. Now reload the Codex extension in chrome://extensions, then verify:");
console.log("  fresh kernel -> tabs.new -> goto busy page -> two evaluates should be <100ms each.");
