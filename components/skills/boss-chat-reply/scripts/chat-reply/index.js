// index.js — 编排入口。在 node_repl 内核中：
//   const M = "/Users/dmeck/.agents/skills/boss-chat-reply/scripts/chat-reply";
//   const R = await import(`${M}/index.js`);
//   const { tab } = await R.connectAndOpenChat(globalThis, "<chrome插件latest目录>");
export { connectAndOpenChat, BOSS_CHAT_URL } from "./browser.js";
export {
  clickUnreadFilter,
  scanList,
  clickListConv,
  openConvBySearch,
  extractConv,
  scrollConvToBottom,
  sendMessages,
  verifyMyLastMessages,
} from "./chat-page.js";
export {
  agreeAndSendResume,
  sendResumeOnceAfterBossReply,
  inspectResumeState,
  checkSendResumeButton,
} from "./resume.js";
