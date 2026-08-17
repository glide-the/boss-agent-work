# 采集数据 Schema 与后续整理

## JSONL 原始记录（每条会话一行）

```json
{
  "key": "姓名|titleBox",
  "name": "董女士",
  "titleBox": "董女士杭州掌玩网络HRBP",
  "listTime": "07月18日",
  "listLastMsg": "[已读] 您好，我的简历筛选通过了吗",
  "term": "杭州掌玩网络",
  "job": { "raw": "AI产品经理（AI Native PM） 20-27K·13薪 杭州 查看职位", "hasViewJob": true },
  "flowCount": 12,
  "flow": [
    { "kind": "time", "text": "昨天 16:33" },
    { "kind": "msg", "sender": "me|recruiter|system", "text": "...", "read": "已读" }
  ],
  "sysTexts": ["对方已同意，您的附件简历已发送给对方"],
  "captcha": false
}
```

异常记录：`{ "key", "error" }` 或 `{ "key", "searchMiss": true, "term", "results" }`。

## 从原始记录判定投递反馈（供整理阶段使用）

- 是否已读：我方最后一条消息 `read` 或文本前缀含 `已读`。
- 是否下载简历/发简历：sysTexts 含 `附件简历请求已发送` / `对方已同意，您的附件简历已发送给对方`。
- 是否主动沟通：flow 中存在 `sender=recruiter` 的消息。
- 是否面试：flow/sysTexts 含 `面试`（线下面试、约面、视频面试）。
- 最后沟通时间：最后一个 `kind=time` 或列表 `listTime`。
- 当前状态：无 recruiter 消息 → 无反馈；有来有回 → 沟通中；含 `不合适|拒绝` → 拒绝；含 `面试` → 面试。

## 岗位方向四分类（整理阶段）

AI产品 / 解决方案 / 交付 / 业务分析。优先级：岗位标题 → 职责 → 关键词 → 仍不明确标「待确认」选最接近类。

## 岗位五维拆解（整理阶段）

每天干什么 / 要什么硬技能 / 要什么业务经验 / 要什么交付证据 / 硬门槛。
规则：原文没写填「未提及」；加分项不写成硬门槛；每项 1-3 条。
