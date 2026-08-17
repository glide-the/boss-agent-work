// browser.js — Codex Chrome 插件 node_repl 内核连接引导
// 运行环境：node_repl 内核（禁止本地 Playwright/Selenium 直连）

// 插件缓存目录：优先固定版本，缺失时回退到 latest（插件升级后版本号会变）
export async function resolvePluginRoot() {
  const base =
    "/Users/dmeck/Downloads/codex-original-dmg-codex-home/plugins/cache/openai-bundled/chrome";
  const fs = await import("node:fs");
  const fixed = base + "/26.601.21317";
  if (fs.existsSync(fixed + "/scripts/browser-client.mjs")) return fixed;
  return base + "/latest";
}

// 建立/恢复 browser 与 tab 连接；幂等，内核重置后可反复调用
export async function setupChrome(sessionName = "💼 BOSS直聘岗位沟通") {
  if (!globalThis.agent) {
    const PLUGIN_ROOT = await resolvePluginRoot();
    const { setupBrowserRuntime } = await import(
      PLUGIN_ROOT + "/scripts/browser-client.mjs"
    );
    await setupBrowserRuntime({ globals: globalThis });
  }
  if (!globalThis.browser) {
    globalThis.browser = await agent.browsers.get("extension");
  }
  await browser.nameSession(sessionName);
  const tabs = await browser.tabs.list();
  globalThis.tab = tabs.length
    ? await browser.tabs.get(tabs[0].id)
    : await browser.tabs.new();
  return { browser: globalThis.browser, tab: globalThis.tab };
}
