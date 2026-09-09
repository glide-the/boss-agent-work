// chat.js — 一次输入多句消息，点击发送按钮并验证结果
export async function sendMessages(tab, msgs) {
  const input = tab.playwright.locator("#chat-input");
  await input.click({ timeoutMs: 8000 });
  const message = msgs.join("\n");
  await input.type(message, { timeoutMs: 15000 });

  // 输入完成后从最新可见 DOM 重新取得当前会话的发送按钮。
  await tab.playwright.waitForTimeout(350);
  let dom = await tab.dom_cua.get_visible_dom();
  let sendNode = dom.match(/<button node_id=(?:"([^"]+)"|(\d+))[^>]*>发送<\/button>/);
  if (!sendNode) {
    await tab.playwright.waitForTimeout(900);
    dom = await tab.dom_cua.get_visible_dom();
    sendNode = dom.match(/<button node_id=(?:"([^"]+)"|(\d+))[^>]*>发送<\/button>/);
  }
  if (!sendNode) throw new Error("send-button-not-found");
  await tab.dom_cua.click({ node_id: sendNode[1] || sendNode[2] });
  await tab.playwright.waitForTimeout(600);

  // 不重复点击发送；只做一次延迟复核，避免网络延迟造成误判。
  let snapshot = await tab.playwright.domSnapshot({ timeoutMs: 8000 });
  dom = await tab.dom_cua.get_visible_dom();
  let messageIndex = snapshot.lastIndexOf(msgs[0]);
  let delivered = messageIndex >= 0 && /送达|已读/.test(snapshot.slice(Math.max(0, messageIndex - 300), messageIndex));
  let composerEmpty = /<div node_id=(?:"[^"]+"|\d+) contenteditable="true"\s*\/>/.test(dom);
  if (!delivered || !composerEmpty) {
    await tab.playwright.waitForTimeout(900);
    snapshot = await tab.playwright.domSnapshot({ timeoutMs: 8000 });
    dom = await tab.dom_cua.get_visible_dom();
    messageIndex = snapshot.lastIndexOf(msgs[0]);
    delivered = messageIndex >= 0 && /送达|已读/.test(snapshot.slice(Math.max(0, messageIndex - 300), messageIndex));
    composerEmpty = /<div node_id=(?:"[^"]+"|\d+) contenteditable="true"\s*\/>/.test(dom);
  }
  if (!delivered || !composerEmpty) throw new Error("send-unverified");
  return msgs.length;
}
