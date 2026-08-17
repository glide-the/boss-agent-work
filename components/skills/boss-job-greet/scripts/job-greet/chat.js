// chat.js — 聊天输入框分句发送（每句一条消息，Enter 发送）
export async function sendMessages(tab, msgs) {
  const input = tab.playwright.locator("#chat-input");
  await input.click({ timeoutMs: 8000 });
  for (const m of msgs) {
    await input.type(m, { timeoutMs: 15000 });
    await tab.playwright.waitForTimeout(350);
    await input.press("Enter", { timeoutMs: 5000 });
    await tab.playwright.waitForTimeout(800);
  }
  return msgs.length;
}
