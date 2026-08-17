// 单个已打开会话的结构化提取。
// 提取：聊天顶部职位条（岗位/薪资/城市/是否有「查看职位」）、
// 消息流（时间/发送方/文本/已读）、系统消息（简历请求、对方已同意等）。

export async function extractOpenChat(tab) {
  return await tab.playwright.evaluate(() => {
    const convo = document.querySelector(".chat-conversation");
    if (!convo) return { error: "no conversation" };

    // 职位条
    const posBox = convo.querySelector(".chat-position-content");
    let job = null;
    if (posBox) {
      job = {
        raw: posBox.innerText.replace(/\s+/g, " ").trim().slice(0, 200),
        hasViewJob: /查看职位/.test(posBox.innerText),
      };
    }

    // 消息流（按 DOM 顺序）
    const flow = [];
    convo.querySelectorAll(".item-time, .message-item").forEach((el) => {
      if (el.classList.contains("item-time")) {
        flow.push({ kind: "time", text: el.textContent.trim() });
      } else {
        const sender = el.classList.contains("item-myself")
          ? "me"
          : el.classList.contains("item-friend")
            ? "recruiter"
            : "system";
        const textEl =
          el.querySelector(".message-content .text") || el.querySelector(".message-content");
        const readEl = el.querySelector('.read-state, [class*="read-state"]');
        flow.push({
          kind: "msg",
          sender,
          text: (textEl ? textEl.innerText : el.innerText).trim().slice(0, 600),
          read: readEl ? readEl.textContent.trim() : "",
        });
      }
    });

    // 系统消息（简历/同意/交换/面试/拒绝 等关键事件）
    const sysTexts = [];
    convo
      .querySelectorAll('[class*="system"], [class*="notice"], [class*="tips"]')
      .forEach((el) => {
        const t = el.innerText?.trim();
        if (t && t.length < 120 && /简历|同意|交换|面试|拒绝|不合适/.test(t)) sysTexts.push(t);
      });

    return {
      job,
      flowCount: flow.length,
      flow: flow.slice(0, 200),
      sysTexts: [...new Set(sysTexts)].slice(0, 10),
    };
  });
}

/** 检测页面是否出现滑块/安全验证（反爬信号）。 */
export async function detectCaptcha(tab) {
  return await tab.playwright.evaluate(() =>
    /滑块|安全验证|请完成验证/.test(document.body.innerText.slice(0, 3000))
  );
}
