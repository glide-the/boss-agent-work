// browser.js — Chrome 插件连接与聊天页打开（node_repl 内核中运行）
// 注意：内核中 node:fs/os/path 不可用，插件根目录必须先在外部 shell 探测后显式传入：
//   ls ~/Downloads/codex-original-dmg-codex-home/plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs
//   ls ~/.codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs

export const BOSS_CHAT_URL = "https://www.zhipin.com/web/geek/chat?ka=header-message";

/**
 * 连接 Chrome 扩展并打开 BOSS 聊天页（每次内核重置后重调）。
 * 始终用 browser.tabs.new() 开新标签页：
 * browser.user.claimTab() 认领的用户标签页没有 playwright 能力，evaluate 会超时。
 */
export async function connectAndOpenChat(g, pluginRoot, sessionName = "💼 BOSS直聘回复") {
  if (!g.agent) {
    const { setupBrowserRuntime } = await import(`${pluginRoot}/scripts/browser-client.mjs`);
    await setupBrowserRuntime({ globals: g });
  }
  const browser = await g.agent.browsers.get("extension");
  await browser.nameSession(sessionName);
  const tab = await browser.tabs.new();
  await tab.goto(BOSS_CHAT_URL);
  await tab.playwright.waitForTimeout(6000);
  g.browser = browser;
  g.tab = tab;
  return { browser, tab };
}
