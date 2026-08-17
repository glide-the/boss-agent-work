// urls.js — 目标岗位分类的稳定搜索 URL（可翻页/滚动，避免推荐流乱序）
export const URLS = {
  // 当前目标任务（会话 019f830d）：AI自动化 / AI解决方案 / AI情感陪伴（均杭州）
  aiAutomationHz:
    "https://www.zhipin.com/web/geek/jobs?city=101210100&query=AI%E8%87%AA%E5%8A%A8%E5%8C%96",
  aiSolutionHz:
    "https://www.zhipin.com/web/geek/jobs?city=101210100&query=AI%E8%A7%A3%E5%86%B3%E6%96%B9%E6%A1%88",
  aiEmotionHz:
    "https://www.zhipin.com/web/geek/jobs?city=101210100&query=AI%E6%83%85%E6%84%9F%E9%99%AA%E4%BC%B4",
  // 历史任务（会话 019f82ec）：IT技术支持(杭州) / 算法工程师(北京)
  itHangzhou:
    "https://www.zhipin.com/web/geek/jobs?city=101210100&query=IT%E6%8A%80%E6%9C%AF%E6%94%AF%E6%8C%81",
  algoBeijing:
    "https://www.zhipin.com/web/geek/jobs?city=110100&query=%E7%AE%97%E6%B3%95%E5%B7%A5%E7%A8%8B%E5%B8%88",
};

// 分类编排：key -> { url, label, msgKind }（msgKind 见 messages.js）
export const CATEGORIES = [
  { key: "aiAutomationHz", label: "AI自动化(杭州)", msgKind: "ai" },
  { key: "aiSolutionHz", label: "AI解决方案(杭州)", msgKind: "ai" },
  { key: "aiEmotionHz", label: "AI情感陪伴(杭州)", msgKind: "emotion" },
];
