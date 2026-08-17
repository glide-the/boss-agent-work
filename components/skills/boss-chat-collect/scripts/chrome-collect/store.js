// 采集状态与 JSONL 落盘。防止 node_repl 内核重置导致进度丢失：
// 每条会话采集完成立即 append 到本地文件，重启后从文件恢复 doneKeys。

import fs from "node:fs";

// 默认落盘位置；可用 configurePaths() 覆盖（如指定项目 data 目录）。
export const PATHS = {
  raw: "/tmp/boss_chats_raw.jsonl",
  workspaceRaw: null, // 设置后 syncToWorkspace 默认写到这里
  prevRaws: [],       // 历史采集文件（用于合并 doneKeys 防止重采）
};

export function configurePaths(opts = {}) {
  Object.assign(PATHS, opts);
  return PATHS;
}

// 兼容旧引用
export const RAW_PATH = PATHS.raw;

/** 从已有 JSONL 恢复已完成的 key 集合。 */
export function loadDoneKeys(paths = [RAW_PATH]) {
  const done = new Set();
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.key) done.add(r.key);
        // 兼容上一轮数据格式：{ item: { name, titleBox } }
        if (r.item?.name) done.add(r.item.name + "|" + (r.item.titleBox || ""));
      } catch {}
    }
  }
  return done;
}

/** 追加一条采集记录。 */
export function appendRecord(rec, path = RAW_PATH) {
  fs.appendFileSync(path, JSON.stringify(rec) + "\n");
}

/** 构建待处理队列：全量列表减去已完成。 */
export function buildQueue(chatListArr, doneKeys) {
  return chatListArr.filter((it) => !doneKeys.has(it.name + "|" + it.titleBox));
}

/** 把落盘文件同步到工作区（需先 configurePaths({ workspaceRaw }) 或显式传 dst）。 */
export function syncToWorkspace(src = PATHS.raw, dst = PATHS.workspaceRaw) {
  if (!dst) throw new Error("workspaceRaw not configured");
  if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  return dst;
}
