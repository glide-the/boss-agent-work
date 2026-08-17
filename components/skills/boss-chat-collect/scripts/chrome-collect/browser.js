// Chrome 扩展 bootstrap。在 node_repl 内核中运行。
// 来自会话 019f7f85：setupBrowserRuntime + agent.browsers.get("extension")

// Chrome 插件根目录按候选顺序自动发现（版本号会随插件升级变化）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function findChromePluginRoot() {
  const candidates = [
    path.join(os.homedir(), "Downloads/codex-original-dmg-codex-home/plugins/cache/openai-bundled/chrome"),
    path.join(os.homedir(), ".codex/plugins/cache/openai-bundled/chrome"),
  ];
  for (const base of candidates) {
    try {
      const versions = fs
        .readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse(); // 取最新版本
      for (const v of versions) {
        const root = path.join(base, v);
        if (fs.existsSync(path.join(root, "scripts/browser-client.mjs"))) return root;
      }
    } catch {}
  }
  throw new Error("Chrome plugin browser-client.mjs not found; is the Codex Chrome plugin installed?");
}

export const BOSS_CHAT_URL = "https://www.zhipin.com/web/geek/chat?ka=header-message";

/**
 * 初始化 browser / tab 全局绑定（幂等）。
 * @param {object} g 内核全局对象（传 globalThis）
 * @param {string} sessionName 浏览器侧会话名（带 emoji 便于识别）
 */
export async function setupChrome(g, sessionName = "💼 BOSS直聘采集") {
  if (!g.agent) {
    const { setupBrowserRuntime } = await import(
      `${findChromePluginRoot()}/scripts/browser-client.mjs`
    );
    await setupBrowserRuntime({ globals: g });
  }
  if (!g.browser) {
    g.browser = await g.agent.browsers.get("extension");
  }
  await g.browser.nameSession(sessionName);
  if (typeof g.tab === "undefined") {
    g.tab = await g.browser.tabs.new();
  }
  return { browser: g.browser, tab: g.tab };
}

/** 打开 BOSS 聊天页并等待渲染。 */
export async function openChatPage(tab, url = BOSS_CHAT_URL) {
  await tab.goto(url);
  await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 20000 });
  await tab.playwright.waitForTimeout(3000);
  return { url: await tab.url(), title: await tab.title() };
}
