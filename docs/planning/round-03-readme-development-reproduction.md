# Round 03：README 教程、开发复线与同类插件参考

## 固定 Prompt Architect 模板

```text
You are an Expert Prompt Architect.

Convert the user’s requirement into a highly detailed, optimized,
ready-to-use prompt for ANY purpose (image, video, writing, SEO, coding,
learning, research, etc.).

Instructions

Identify what the user is trying to achieve.
Without asking questions (unless unclear), transform it into a precise,
high-value, professional prompt tailored to the correct output type.
Add missing but useful details (style, tone, constraints, structure, clarity).
Ensure the prompt is copy-paste ready for the intended AI tool.

Deliver:
Optimized Prompt - the final refined prompt
Optional Enhancers - optional add-ons that the user can include

OUTPUT FORMAT
Optimized Prompt:
[Expert-level prompt based on the requirement]

USER REQUIREMENT: {{task}}
```

## Optimized Prompt

扩充 `/Users/dmeck/project/boss-agent-work/develop/README.md`，使新用户能够从零完成 Boss投递的构建、Codex marketplace 安装、Native Host 初始化、Chrome 解压扩展加载、连接验证和首次使用。结合用户提供的三张运行截图，以及 Notion「Boss」项目中可访问的开发记录，整理项目从任务交付包拆分、身份隔离、Chrome 扩展重建、Native Host 恢复、Electron 安装生命周期、调试技能整理、构建矩阵、live 修复到 GitHub 交付的完整开发过程；明确哪些内容是历史事实、源码推断和当前验证结果。

补充一套“如何从零复现本项目”和“如何参考本项目开发类似 Codex Chrome 插件”的工程指南，包含目录结构、身份配置、消息协议、构建物边界、测试门禁、安全约束和常见失败模式。README 保持首页可读，详细过程下沉到 `docs/` 并由 README 建立清晰导航。不得把语义重建源码描述为官方源码，不得把 manifest 存在描述为浏览器业务动作已验收，也不得公开截图中的真实账号、聊天对象或招聘业务信息。

## Optional Enhancers

- 已采用：用 Mermaid 展示运行链路和开发复线。
- 已采用：用 evidence / inference / residual 标注证据强度。
- 已采用：将快速使用、历史复线和通用开发指南拆成三个阅读层级。
- 已采用：保留用户截图的观察结论，但不将含个人和招聘信息的原图提交到公开仓库。
- 暂不采用：新增安装向导、设置页或演示站；本轮只完善文档，不引入新的产品功能。

## 输入、证据和访问边界

- 仓库提交：`0bdb0e8`、`3bd6340`、`0d19d01`。
- 历史任务：`019fa2d1-cf87-76f2-8a83-334ccc494ed7` 的交付包、manifest 和日志证据。
- 本地规划：Round 01 Native Host 生命周期、Round 02 手动安装说明。
- 当前源码：Chrome extension、Electron Main lifecycle、Rust 语义重建 Host、Codex plugin 和 7 个技能。
- 用户截图：Chrome 调试连接、Codex 批处理会话、Codex 定时任务列表。
- Notion：用户提供的页面无法通过未认证网页读取，且未被公开搜索索引；因此本轮不引用其正文事实，只保留外部项目入口并记录这一限制。

## 本轮范围

1. README 增加适合首次使用者的安装、验证、首次运行和定时任务使用教程。
2. 新增开发复线文档，说明需求、根因、设计、实现、验证和回滚。
3. 新增同类插件开发指南，提供可复用的身份、架构、构建、生命周期和质量门禁。
4. 核对所有命令、路径、版本和身份与当前代码一致。

## 非目标与过度设计检查

- 不修改 Chrome 扩展、Native Host 或 Electron 生命周期逻辑。
- 不增加新的构建档位、GUI、服务端、数据库或遥测。
- 不把 Codex 定时任务误写成 Chrome 扩展自身能力。
- 不发布含真实用户名、招聘者头像、聊天列表或职位隐私信息的截图。
- 不因 Notion 不可访问而阻塞可由仓库证据完成的文档工作。

## 完成条件

- README 从零使用流程可执行，并链接详细手册。
- 开发过程可以沿仓库证据逐阶段复线，每个结论能定位到提交或文件。
- 同类插件指南明确独立身份、Native Messaging、Electron 职责和验收分层。
- Markdown 本地链接有效；`make verify` 通过；工作区没有意外构建或用户配置改动。

## 执行结果（2026-08-17）

- settled：README 已增加五分钟安装、首次只读测试、候选筛选、确认后沟通、定时任务边界和五层验收。
- settled：新增 `docs/development-history.md`，从历史任务到 GitHub 工程按事实、推断和残余复线。
- settled：新增 `docs/plugin-development-guide.md`，覆盖独立身份、标准插件结构、Native Messaging、Electron lifecycle、构建物边界和发布门禁。
- settled：三张用户截图已用于核对运行形态；因含真实账号和招聘信息，没有复制进公开仓库。
- residual：Notion 分享页未向未认证读取开放，正文尚未逐条纳入；README 保留外部项目入口并明确证据边界。
- settled：4 份本轮 Markdown 的本地链接检查、`git diff --check`、插件/技能验证和 Electron lifecycle 测试 8/8 通过。
