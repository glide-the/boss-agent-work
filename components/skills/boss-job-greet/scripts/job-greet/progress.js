// progress.js — JSONL 进度落盘与断点恢复（防内核重置丢进度）
export async function createProgress(filePath, extraIds = []) {
  const fs = await import("node:fs");
  const processedIds = new Set(extraIds);
  const doneKeys = new Set();
  if (fs.existsSync(filePath)) {
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.id) processedIds.add(r.id);
        if (r.title) doneKeys.add((r.title + "|").replace(/\s+/g, ""));
      } catch {}
    }
  }
  return {
    fs,
    processedIds,
    doneKeys,
    log(rec) {
      fs.appendFileSync(filePath, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
      if (rec.id) processedIds.add(rec.id);
      if (rec.title) doneKeys.add((rec.title + "|").replace(/\s+/g, ""));
    },
  };
}
