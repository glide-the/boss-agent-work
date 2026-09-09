# 项目技能软连接迁移结果

日期：2026-09-09

## 回灌内容

已把 `~/.agents/skills` 中项目尚未收录的以下修改合并到 `components/skills`：

- `boss-chat-reply`：Boss 首次回复后的单次简历发送、页面与持久化双重去重、严格按钮定位、发送结果校验及 4 个单元测试。
- `boss-job-greet`：首次建联延迟、一次恢复重试、重新定位发送按钮、送达与输入框清空校验。
- `boss-chat-collect`：优先发现个人 `chrome-dev` 插件 cache。
- `boss-send-resume-button`：正式“求简历”卡片的按钮专用发送流程、严格按钮匹配和成功确认。
- 三个 Chrome 调试/修复技能：Luna 隔离测试阶段的执行边界。

项目侧较新的个人插件 Statsig 排障结论已保留，没有被用户目录旧文本覆盖。

## 当前链接

以下六个入口现在是指向项目源码的绝对软连接：

```text
~/.agents/skills/boss-chat-collect
~/.agents/skills/boss-chat-reply
~/.agents/skills/boss-job-greet
~/.agents/skills/chrome-plugin-debug
~/.agents/skills/chrome-plugin-fix-delivery
~/.agents/skills/chrome-plugin-hang-fix
```

以下两个技能保持原有 Codex 技能根，但改为软连接：

```text
~/.codex/skills/boss-send-resume-button
~/.codex/skills/chrome-file-upload-patterns
```

`boss-delivery` 仍由 `chrome-dev` marketplace 提供，不在 `~/.agents/skills` 建立重复入口。其他用户技能没有改动。

## 迁移备份

迁移前实体目录保存在：

```text
/Users/dmeck/.agents/backups/project-skill-links/20260909T145246Z-26973/
/Users/dmeck/.codex/backups/project-skill-links/20260909T145246Z-26973/
/Users/dmeck/.codex/backups/project-skill-links/20260909T145456Z-35310/
```

## 验证

- 八个链接全部解析到 `/Users/dmeck/project/boss-agent-work/develop/components/skills` 中的对应源码。
- `make install-skills` 重复执行全部返回 `Project skill link ready`。
- `--check` 只读验证通过。
- 安装器隔离测试覆盖路径含空格、实体目录迁移、错误链接修复、差异拒绝、显式迁移、重复执行和无关技能保留。
- 九个项目技能结构验证通过；所有 JavaScript 语法检查通过。
- `boss-chat-reply` 新增的 4 个简历去重测试通过。
- 完整 `make verify` 通过。
