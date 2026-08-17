# BOSS 直聘聊天页 DOM 选择器（2026-07 验证）

页面：`https://www.zhipin.com/web/geek/chat?ka=header-message`

## 聊天列表（左侧，虚拟滚动）

- 容器：`.chat-user .user-list-content`
- 列表项：`li`
  - 招聘人姓名：`.name-text`
  - 姓名+公司+招聘人职位拼接：`.title-box`
  - 最后一条消息预览：`.last-msg`
  - 时间：`.time` 或 `[class*="time"]`
- 列表为虚拟滚动，只渲染可见项；必须用 `tab.cua.scroll`（滚轮坐标落在列表区域，如 x=300,y=500）触发加载。`evaluate` 是只读作用域，直接改 `scrollTop` 无效。
- 去重 key：`name + "|" + titleBox`。

## 会话区（右侧）

- 根节点：`.chat-conversation`
- 职位条：`.chat-position-content`
  - 文本形如 `AI产品经理（AI Native PM） 20-27K·13薪 杭州 查看职位`
  - 「查看职位」按钮：`.chat-position-content .right-content`（点击后开新用户标签页 `/job_detail/...`）
- 消息流（按 DOM 顺序遍历）：
  - 时间分隔：`li.item-time`
  - 消息：`.message-item`，方向类名 `item-myself`（我）/ `item-friend`（招聘方）/ 其余视为 system
  - 消息正文：`.message-content .text`（没有则退化为 `.message-content`）
  - 已读标记：`.read-state` 或我方消息文本内的 `已读`/`送达` 前缀
- 系统消息（简历请求/对方已同意/换微信等）：`[class*="system"], [class*="notice"], [class*="tips"]`，按关键词 `简历|同意|交换|面试|拒绝|不合适` 过滤。

## 搜索定位（列表限流后）

- 搜索框：`getByPlaceholder("搜索30天内的联系人")`
- 下拉结果：`.boss-search-result .search-list`（li，文本含 `姓名 公司 职位 职位: 岗位名`）
- 搜索词：从 titleBox 去掉姓名前缀和招聘人职位后缀（`buildSearchTerm`），公司名不足 2 字时用姓名。

## 职位详情页（/job_detail/...）

- 岗位名：`.job-banner .name, .name h1, .job-primary .name`
- 薪资：`.job-banner .salary, .salary`
- 要求信息（经验/学历）：`.job-banner .job-primary, .job-primary`
- JD 正文：`.job-sec-text, .job-detail-section .text, [class*="job-sec"] .text`
- 公司名：`.company-info .name, .sider-company .name`
- 公司信息块：`.sider-company, .company-info`（行业/规模/融资阶段在其中）
- 详情页由用户标签页打开，用 `browser.user.openTabs()` 找到 `/job_detail/` 后 `browser.user.claimTab()` 认领再抽取。

## 反爬信号

- 滑块/安全验证：body 文本含 `滑块|安全验证|请完成验证` → 停止采集并报告。
- 列表限流：连续打开数百会话后，列表只返回前 50 条且滚动不再加载 → 切换搜索定位。
