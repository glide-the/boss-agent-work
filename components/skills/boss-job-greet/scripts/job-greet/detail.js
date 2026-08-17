// detail.js — 岗位详情自动校验 + 风控/验证码/沟通上限检测

// 详情页信息提取：标题、banner、JD 前段、沟通按钮文案、是否触发风控
export async function extractJobDetail(tab) {
  return await tab.playwright.evaluate(() => {
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ");
    const blocked =
      /安全验证|滑块|拖动下方滑块|账号异常|访问受限|操作频繁|短信验证/.test(bodyText);
    const title = (
      document.querySelector(".job-banner .job-title, .job-sec .name h1, .name h1, h1")
        ?.textContent || ""
    ).trim();
    const banner = (
      document.querySelector(".job-banner, .job-primary, .info-primary")?.textContent || ""
    ).replace(/\s+/g, " ").trim();
    const desc = (
      document.querySelector(".job-sec-text, .job-detail-section .text")?.textContent || ""
    ).replace(/\s+/g, " ").trim();
    const chatBtn = Array.from(document.querySelectorAll("a,button")).find((e) =>
      /立即沟通|继续沟通/.test((e.textContent || "").trim())
    );
    return {
      blocked,
      title,
      banner: banner.slice(0, 120),
      descHead: desc.slice(0, 400),
      chatBtnText: chatBtn ? chatBtn.textContent.trim() : "",
      url: location.href,
    };
  });
}

// 聊天页状态检测：输入框、沟通上限、风控
export async function checkChatPage(tab) {
  return await tab.playwright.evaluate(() => {
    const t = (document.body?.innerText || "").replace(/\s+/g, " ");
    const input = document.querySelector("#chat-input, [contenteditable=true].chat-input");
    const jobBar = (
      document.querySelector(".chat-conversation .job-banner, .position-bar, .chat-job")
        ?.textContent || ""
    ).replace(/\s+/g, " ").trim();
    return {
      onChat: /\/web\/geek\/chat/.test(location.href),
      hasInput: !!input,
      limit: /今日.*沟通.*上限|沟通次数.*达.*限|今日已沟通|操作频繁|稍后再试/.test(t),
      blocked: /安全验证|滑块|账号异常|短信验证/.test(t),
      jobBar: jobBar.slice(0, 120),
    };
  });
}
