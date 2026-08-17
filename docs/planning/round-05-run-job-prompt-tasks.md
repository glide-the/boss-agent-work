# Round 05：配套任务仓库与 Prompt 任务入口

## Optimized Prompt

更新 Boss投递 README，把 `boss-agent-run-job` 作为运行 Prompt 任务的必备配套项目重点说明。要求用户先将 `git@github.com:glide-the/boss-agent-run-job.git` 克隆到本地 `/Users/dmeck/project/boss-agent`，说明该仓库包含任务脚本、配置、数据目录、简历上下文和 Prompt 任务包；已有仓库时提供安全更新方式。

核对并列出以下三个真实 ZIP：

- `docs/0bdbbc7c-30c4-4794-8fbc-49075ee96088_ExportBlock-d2fe6b20-1623-40bf-9bcb-263dd0f4ad19.zip`
- `docs/56352147-341a-4d7d-97d1-a56e69e93f9b_ExportBlock-ac15ed3a-0e59-466f-8e8d-b532cff91020.zip`
- `docs/9cd6133d-45d1-4184-9981-bacce2685449_ExportBlock-c242f613-5ade-46be-add3-3777d639d352.zip`

说明每个外层 ZIP 内含一个 `Part-1.zip`，最终任务正文是内层 Markdown。给出可直接复制到 Codex 的启动 Prompt：把工作目录设为 `/Users/dmeck/project/boss-agent`，读取并解压指定 ZIP，完整读取 Markdown，先汇总外部动作和停止条件，经用户确认后再通过 Boss投递执行。不得把仓库的 agent-browser/Bun 轨迹脚本冒充成这三个 Prompt 明确要求的 `@chrome-dev` 插件链路。

## Optional Enhancers

- 已采用：按“批量投递 → 沟通跟进 → 汇总到飞书”给出推荐运行顺序。
- 已采用：提供仓库首次克隆、已有仓库更新、依赖安装和文件检查命令。
- 已采用：强调三个任务会产生沟通、投递、日历或飞书写入等外部影响，必须先确认。

## 完成条件

- README 醒目展示必需仓库、固定本地路径和三个任务包。
- 所有文件名、仓库 remote、任务标题和运行方式与本地事实一致。
- Prompt 任务使用 Boss投递，不自动切换到其他浏览器工具。
- README 链接、图片和 Markdown 差异检查通过。

## 执行结果（2026-08-17）

- settled：本地 `/Users/dmeck/project/boss-agent` 的 remote 已核对为 `git@github.com:glide-the/boss-agent-run-job.git`。
- settled：三个外层 ZIP 均存在，并已核对内层 Markdown 标题与任务用途。
- settled：README 已新增首次克隆、已有仓库更新、`bun install`、固定 Codex 工作目录和任务启动 Prompt。
- settled：明确区分仓库中的 Bun/agent-browser 轨迹脚本与三个 Prompt 强制使用的 Boss投递 `@chrome-dev` 链路。
- settled：README 相对链接、三张图片、三个本地任务包路径和 `git diff --check` 均通过。
