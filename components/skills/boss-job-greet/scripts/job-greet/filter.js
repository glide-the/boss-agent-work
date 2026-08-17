// filter.js — 岗位筛选规则与去重
// 必须跳过：实习/销售/客服/人事/行政/运营/市场/主播/标注/话术/控图/漫剧/总助 等
export const SKIP_RE =
  /实习|销售|客服|人事|行政|运营|市场|主播|标注|话术|控图|漫剧|总经理项目助理/;

export function shouldSkip(card) {
  return SKIP_RE.test(card.title) || /元\/天/.test(card.txt || "");
}

// 从卡片文本提取公司名（城市名前的最后一个词）
export function companyFromTxt(txt) {
  const m = (txt || "").match(/([^\s]+)\s*(杭州|北京|上海|广州|深圳)[·\s]/);
  return m ? m[1] : "";
}

// 构造处理队列项；PM 岗位使用 pm 消息模板
export function mkQ(card, kind) {
  return {
    id: card.id,
    title: card.title,
    company: companyFromTxt(card.txt),
    kind: kind || (/产品/.test(card.title) ? "pm" : "ai"),
  };
}

// 规范化去重键：标题（去空白）。跨页 jobId 会变，标题键更稳
export function titleKey(title) {
  return (title || "").replace(/\s+/g, "");
}

// 过滤：跳过规则 + 与历史 doneKeys 双向前缀去重（前 10 字）
export function makeQueue(cards, doneKeys, defaultKind) {
  return cards
    .filter((c) => {
      if (shouldSkip(c)) return false;
      const tk = titleKey(c.title);
      for (const k of doneKeys) {
        if (k.startsWith(tk.slice(0, 10)) || tk.startsWith(k.slice(0, 10))) return false;
      }
      return true;
    })
    .map((c) => mkQ(c, defaultKind));
}
