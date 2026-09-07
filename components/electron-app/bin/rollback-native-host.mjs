#!/usr/bin/env bun
import { rollbackNativeHostBackup } from "../src/native-host-backup.mjs";
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === "--help") {
  console.log("Usage: bun bin/rollback-native-host.mjs /absolute/path/to/snapshot.json");
  process.exitCode = args[0] === "--help" ? 0 : 2;
} else {
  try { console.log(JSON.stringify(await rollbackNativeHostBackup(args[0]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
