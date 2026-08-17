# BOSS 直聘聊天页 DOM 选择器（2026-07-22 验证）

页面：`https://www.zhipin.com/web/geek/chat?ka=header-message`

## 列表筛选（左栏顶部）

- 容器：`.chat-user .label-list`，子项为 `li`
- 选项顺序：`全部` | `未读(N)` | `新招呼` | `更多`（下拉：仅沟通/有交换/有面试/不感兴趣）| `AI筛选`
- 点未读：找 `li` 文本以 `未读` 开头的下标，`locator('.chat-user .label-list li').nth(idx).click()`

## 聊天列表（左栏，虚拟滚动）

- 容器：`.chat-user .user-list-content`
- 列表项：`li`
  - 招聘人姓名：`.name-text`
  - 姓名+公司+招聘人职位：`.title-box`（截断显示，如 `王佳菁杭州朗视视频技术...招聘者`）
  - 最后一条消息预览：`.last-msg`
  - 时间：`.time` 或 `[class*="time"]`
  - 未读徽标：`[class*="badge"], [class*="unread"], [class*="count"], [class*="num"]`
- 虚拟滚动只渲染可见项；滚动加载用 `tab.cua.scroll({x:300,y:500,scrollX:0,scrollY:900})`，`evaluate` 改 scrollTop 无效
- 列表限流时只返回约 50 条且滚动不再加载 → 用搜索定位
- 列表按最新消息时间排序：已回复/已读的会话位置会移动，未读筛选后已处理条目会消失

## 搜索定位

- 搜索框：`getByPlaceholder("搜索30天内的联系人")`
- 结果列表：`.boss-search-result .search-list li`（文本含 `姓名 公司 职位 职位: 岗位名`）
- 同名联系人用公司名子串消歧

## 会话区（右栏）

- 根节点：`.chat-conversation`
- 会话人姓名：`.chat-conversation [class*="name"]`（打开会话后核对归属用）
- 职位条：`.chat-position-content`，形如 `AI智能体应用高级研发工程师12-20K杭州查看职位`
- 消息流（虚拟化， slice 渲染窗口可能不含最新几条，核验前先滚到底）：
  - 时间分隔：`li.item-time`
  - 消息：`.message-item`，方向类 `item-myself`（我）/ `item-friend`（招聘方）/ 其他为 system
  - 正文：`.message-content .text`（退化为 `.message-content`）
  - 我方消息前缀含 `已读`/`送达` 状态
- 输入框：`#chat-input`，`type` + `press("Enter")` 逐句发送

## 简历请求卡片与发送弹窗

- 请求卡片：`.chat-conversation .message-card-wrap`，文本形如 `我想要一份您的附件简历，您是否同意拒绝同意`
- 按钮组：`.message-card-buttons span.card-btn`，「拒绝」「同意」两个相邻按钮，文本严格匹配
- 同意后弹窗：`.dialog-wrap.active`
  - 简历列表：`.resume-list .list-item`（含文件名、`更新于` 时间、大小）
  - 发送按钮：`.btn-confirm`（文本 `发送`）
- 成功系统消息：`您的附件简历 xxx 已发送给Boss`
- 误拒系统消息：`您已拒绝向对方发送简历`
- 工具栏「发简历」按钮：`div.toolbar-btn`（文本 `发简历`），无正式请求卡片时为 `unable` 禁用态

## 反爬信号

- body 文本含 `滑块|安全验证|请完成验证` → 停止并报告，不绕过
