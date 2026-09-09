# 项目技能单一源码与软连接设计

## 已确认问题

`components/skills` 中有六个技能在 `~/.agents/skills` 下仍是独立实体目录。两边已经出现双向漂移：用户目录包含项目尚未收录的简历去重、首次建联恢复、发送确认和测试阶段执行模型；项目目录包含新版个人插件的 Statsig 排障结论。继续用复制安装会让任一侧的后续编辑无法自动出现在另一侧。

`chrome-file-upload-patterns` 由现有 `scripts/install-project-skills.sh` 用 `rsync --delete` 复制到 `$CODEX_HOME/skills`，也存在同类漂移风险。`boss-send-resume-button` 原先只存在于 `$CODEX_HOME/skills`，需要先回灌到项目再改为链接。`boss-delivery` 由 `chrome-dev` marketplace 提供，不应再放入 `~/.agents/skills` 造成重复发现。

## 目标映射

| 项目源码 | 用户入口 | 原因 |
| --- | --- | --- |
| `components/skills/boss-chat-collect` | `$AGENTS_HOME/skills/boss-chat-collect` | 现有个人技能 |
| `components/skills/boss-chat-reply` | `$AGENTS_HOME/skills/boss-chat-reply` | 现有个人技能 |
| `components/skills/boss-job-greet` | `$AGENTS_HOME/skills/boss-job-greet` | 现有个人技能 |
| `components/skills/chrome-plugin-debug` | `$AGENTS_HOME/skills/chrome-plugin-debug` | 现有个人技能 |
| `components/skills/chrome-plugin-fix-delivery` | `$AGENTS_HOME/skills/chrome-plugin-fix-delivery` | 现有个人技能 |
| `components/skills/chrome-plugin-hang-fix` | `$AGENTS_HOME/skills/chrome-plugin-hang-fix` | 现有个人技能 |
| `components/skills/boss-send-resume-button` | `$CODEX_HOME/skills/boss-send-resume-button` | 保持按钮专用技能的现有 Codex 安装位置 |
| `components/skills/chrome-file-upload-patterns` | `$CODEX_HOME/skills/chrome-file-upload-patterns` | 保持当前 Codex 技能安装位置 |

默认 `AGENTS_HOME=$HOME/.agents`、`CODEX_HOME=$HOME/.codex`。两个根目录都必须是绝对路径，且不能是 `/`。

## 迁移规则

1. 先把用户目录中确认较新的内容合并回项目，并保留项目侧较新的远程初始化排障内容。
2. 目标已经是指向正确源码的软连接时返回 `no-op`。
3. 目标是错误或失效软连接时只替换链接本身。
4. 目标是实体目录时，必须与项目源码逐文件一致；有漂移则在任何写入前拒绝整批迁移，防止静默丢失用户修改或形成半迁移状态。
5. 一致目录先移动到对应根目录的 `backups/project-skill-links/<timestamp>/`，再创建绝对软连接；迁移可恢复且备份不会被当作技能扫描。
6. 不扫描或修改映射表之外的用户技能。

## 初始化与验证

`make setup` 和 `make install-skills` 继续调用同一脚本，但脚本只创建/校验软连接，不再复制文件。支持 `--check` 进行只读验证。测试在临时 HOME、AGENTS_HOME 和 CODEX_HOME 中覆盖实体目录迁移、重复执行、错误链接修复、漂移拒绝和无关技能保留。

## 评审

| 检查项 | 结论 | 理由 |
| --- | --- | --- |
| 是否消除双向漂移 | 通过 | 用户入口直接解析到项目源码。 |
| 是否保留用户目录新改动 | 通过 | 先合并再建链，冲突项逐项保留两边有效变化。 |
| 是否影响无关技能 | 通过 | 使用显式映射，不替换整个 `~/.agents/skills`。 |
| 是否造成重复技能 | 通过 | marketplace 的 `boss-delivery` 和 Codex 根下的上传技能不重复链接到 agents 根。 |
| 是否可恢复 | 通过 | 首次迁移的实体目录移动到根目录外的带时间戳备份。 |
| 是否幂等 | 通过 | 正确链接重复执行返回 `no-op`。 |
