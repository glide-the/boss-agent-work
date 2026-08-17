// process.js — 单岗位全流程与批处理
import { extractJobDetail, checkChatPage } from "./detail.js";
import { sendMessages } from "./chat.js";
import { pickMsgs } from "./messages.js";

// 直达详情页 -> 校验 -> 立即沟通 -> 分句发送
// meta: { title, company, city }; msgs: string[]（第一句须与岗位需求相关）
export async function processJobByUrl(tab, id, meta, msgs) {
  const rec = { id, title: meta.title, company: meta.company, city: meta.city, result: "", note: "" };
  try {
    await tab.goto(`https://www.zhipin.com/job_detail/${id}.html`);
    await tab.playwright
      .waitForLoadState({ state: "domcontentloaded", timeoutMs: 15000 })
      .catch(() => {});
    await tab.playwright.waitForTimeout(2200);
    const det = await extractJobDetail(tab);
    rec.detailTitle = det.title;
    if (det.blocked) {
      rec.result = "blocked";
      rec.note = "出现安全验证/访问限制";
      return rec;
    }
    if (!det.chatBtnText) {
      rec.result = "no-chat-btn";
      rec.note = "无沟通按钮（可能已下架）";
      return rec;
    }
    if (/继续沟通/.test(det.chatBtnText)) {
      rec.result = "already-communicated";
      rec.note = "此前已建立沟通，跳过避免重复打扰";
      return rec;
    }
    const btn = tab.playwright.getByText("立即沟通", { exact: false }).first();
    await btn.click({ timeoutMs: 8000 });
    await tab.playwright.waitForTimeout(3500);
    // BOSS 每日沟通额度提示弹窗（“您今天已与N位BOSS沟通”）：点击“好”完成沟通动作
    // 同时记录弹窗文本（含剩余额度），便于额度管理
    const noticeOk = tab.playwright.getByText("好", { exact: true }).first();
    if (await noticeOk.isVisible().catch(() => false)) {
      try {
        const dlgText = await tab.playwright
          .evaluate(() => {
            const els = [...document.querySelectorAll("div,section,p")];
            const hit = els.find((e) => /今天已与|位BOSS沟通|还剩/.test(e.textContent || "") && e.children.length < 12);
            return hit ? (hit.textContent || "").replace(/\s+/g, " ").slice(0, 120) : "";
          })
          .catch(() => "");
        if (dlgText) rec.quotaNotice = dlgText;
      } catch {}
      await noticeOk.click({ timeoutMs: 5000 }).catch(() => {});
      await tab.playwright.waitForTimeout(2500);
    }
    const chat = await checkChatPage(tab);
    if (chat.blocked) {
      rec.result = "blocked";
      rec.note = "聊天页出现安全验证";
      return rec;
    }
    if (chat.limit) {
      rec.result = "daily-limit";
      rec.note = "触发平台沟通次数上限";
      return rec;
    }
    if (!chat.onChat || !chat.hasInput) {
      rec.result = "chat-open-failed";
      rec.note = "未进入聊天页或无输入框";
      return rec;
    }
    const n = await sendMessages(tab, msgs);
    rec.result = "已沟通+已发送消息";
    rec.note = `发送${n}条短消息`;
    return rec;
  } catch (e) {
    rec.result = "error";
    rec.note = String(e && e.message ? e.message : e).slice(0, 160);
    return rec;
  }
}

// 批处理：逐个处理队列项，落盘 + 去重记录；触发平台限制即停止
// 返回 { results, stopped }
export async function runChunk(tab, items, category, progress, jobResults) {
  const results = [];
  let stopped = false;
  for (const c of items) {
    const msgs = pickMsgs(c.kind, c.title);
    const r = await processJobByUrl(tab, c.id, { title: c.title, company: c.company, city: "杭州" }, msgs);
    r.category = category;
    if (jobResults) jobResults.push(r);
    if (progress) progress.log(r);
    results.push(r);
    if (/daily-limit|blocked/.test(r.result)) {
      stopped = true;
      break;
    }
  }
  return { results, stopped };
}
