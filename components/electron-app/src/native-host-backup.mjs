import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "./plugin-trust-preflight.mjs";

async function state(filePath) {
  try {
    const info = await fs.lstat(filePath);
    if (info.isSymbolicLink()) return { kind: "symlink", target: await fs.readlink(filePath) };
    if (!info.isFile()) throw new Error(`CONFIG_CONFLICT: Refusing non-file registration target ${filePath}`);
    const bytes = await fs.readFile(filePath);
    return { kind: "file", bytes: bytes.toString("base64"), mode: info.mode & 0o777, sha256: sha256(bytes) };
  } catch (error) { if (error.code === "ENOENT") return { kind: "absent" }; throw error; }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function backupNativeHostTargets(codexHome, paths) {
  const entries = await Promise.all([...new Set(paths)].map(async (filePath) => ({ path: filePath, before: await state(filePath) })));
  const directory = path.join(codexHome, "backups", `personal-plugin-native-host-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, "snapshot.json");
  await fs.writeFile(filePath, JSON.stringify({ schemaVersion: 1, entries }, null, 2), { mode: 0o600, flag: "wx" });
  return { filePath, entries };
}

export async function sealNativeHostBackup(backup) {
  for (const entry of backup.entries) entry.after = await state(entry.path);
  await fs.writeFile(backup.filePath, JSON.stringify({ schemaVersion: 1, entries: backup.entries }, null, 2), { mode: 0o600 });
}

export async function rollbackNativeHostBackup(filePath) {
  const backup = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (backup.schemaVersion !== 1 || !Array.isArray(backup.entries) || backup.entries.length === 0) throw new Error("CONFIG_CONFLICT: Invalid recovery snapshot.");
  for (const entry of backup.entries) {
    if (!path.isAbsolute(entry.path) || !entry.after || !entry.before || !["absent", "file", "symlink"].includes(entry.before.kind)) throw new Error("CONFIG_CONFLICT: Unsealed or invalid recovery snapshot.");
    const current = await state(entry.path);
    if (!same(current, entry.after) && !same(current, entry.before)) throw new Error(`CONFIG_CONFLICT: ${entry.path} changed after initialization; refusing rollback.`);
  }
  for (const entry of [...backup.entries].reverse()) {
    if (same(await state(entry.path), entry.before)) continue;
    if (entry.before.kind === "absent") await fs.unlink(entry.path);
    else if (entry.before.kind === "symlink") {
      await fs.rm(entry.path, { force: true });
      await fs.symlink(entry.before.target, entry.path);
    } else {
      const temporary = `${entry.path}.restore-${randomUUID()}`;
      await fs.writeFile(temporary, Buffer.from(entry.before.bytes, "base64"), { mode: entry.before.mode, flag: "wx" });
      await fs.rename(temporary, entry.path);
    }
  }
  return { restored: true, snapshot: filePath };
}
