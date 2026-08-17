# Round 06：将 Prompt 任务细节移入安装说明

## Optimized Prompt

精简 Boss投递 README 中新增的配套仓库章节：README 只保留用户指定的 `boss-agent-run-job` 介绍句，不保留克隆、更新、依赖安装、三个 ZIP、推荐顺序或 Codex 启动 Prompt。将这些完整操作步骤移动到 `docs/manual-install.md`，作为安装后的“准备任务仓库与运行 Prompt 任务”章节，并保持命令、文件路径、任务名称、安全确认和 `@chrome-dev` 工具约束不变。

## Optional Enhancers

- 已采用：README 仅承担快速介绍，安装说明承担完整执行步骤。
- 已采用：三个嵌套 ZIP 的说明、运行顺序和启动 Prompt 集中在同一章节。
- 已采用：保留真实外部动作确认与连接失败停止条件。

## 完成条件

- README 只保留用户指定的独立仓库说明句。
- 安装说明可独立指导克隆、更新、安装依赖并启动三个 Prompt 任务。
- 相对链接和 Markdown 差异检查通过。

## 执行结果（2026-08-17）

- settled：README 中的克隆命令、更新命令、ZIP 表格和任务启动 Prompt 已全部移除，只保留指定介绍句。
- settled：完整内容已迁入 `docs/manual-install.md` 的“零、准备任务仓库并运行 Prompt 任务”。
- settled：README 和安装说明的相对链接检查、三个截图路径与 `git diff --check` 均通过。
