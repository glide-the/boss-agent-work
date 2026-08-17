// 「查看职位」岗位详情抽取。
// 点击聊天顶部职位条的「查看职位」会打开一个新的用户标签页，
// 需要用 browser.user.openTabs() 找到它并 claimTab 认领后再抽取。

/** 从职位详情页抽取 JD 与公司信息。 */
export async function extractJobDetail(jobTab) {
  return await jobTab.playwright.evaluate(() => {
    const txt = (sel) => document.querySelector(sel)?.innerText?.trim() || "";
    const name = txt(".job-banner .name, .name h1, .job-primary .name") || document.title;
    const salary = txt(".job-banner .salary, .salary");
    const infoPrimary = txt(".job-banner .job-primary, .job-primary");
    const jd = txt('.job-sec-text, .job-detail-section .text, [class*="job-sec"] .text');
    const company = txt(
      '.company-info .name, .sider-company .name, [class*="company-info"] [class*="name"]'
    );
    const companyInfo = txt(".sider-company, .company-info");
    const all = document.body.innerText;
    const expMatch = all.match(/(\d+-\d+年|经验不限|\d+年以上|应届)/);
    const eduMatch = all.match(/(博士|硕士|本科|大专|学历不限|高中|中专)/);
    return {
      url: location.href.split("?")[0],
      title: document.title,
      name,
      salary,
      infoPrimary: infoPrimary.slice(0, 200),
      jd: jd.slice(0, 3000),
      company,
      companyInfo: companyInfo.slice(0, 300),
      exp: expMatch?.[0] || "",
      edu: eduMatch?.[0] || "",
    };
  });
}

/**
 * 在当前聊天的职位条上点击「查看职位」，认领新开的详情页并抽取。
 * 详情页仍归用户所有（不关闭）。
 */
export async function openAndExtractJob(browser, tab) {
  await tab.playwright.locator(".chat-position-content .right-content").first().click();
  await tab.playwright.waitForTimeout(4000);
  const userTabs = await browser.user.openTabs();
  const jobTabInfo = userTabs.find((t) => /job_detail/.test(t.url || ""));
  if (!jobTabInfo) return { error: "job detail tab not found" };
  const jobTab = await browser.user.claimTab(jobTabInfo);
  return await extractJobDetail(jobTab);
}
