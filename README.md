# Boss投递

Boss投递是一个配合 Codex 使用的 Chrome 插件，可以在你当前登录的 BOSS 直聘页面中读取岗位、筛选职位、整理沟通内容并跟进求职进度。

## 必需：先下载任务仓库

Boss投递负责控制 Chrome；实际的 Prompt 任务、辅助脚本、配置和任务数据位于独立仓库 [boss-agent-run-job](https://github.com/glide-the/boss-agent-run-job)。运行任务前，必须先把它下载到固定路径：

```bash
mkdir -p /Users/dmeck/project
git clone git@github.com:glide-the/boss-agent-run-job.git \
  /Users/dmeck/project/boss-agent

cd /Users/dmeck/project/boss-agent
bun install
```

如果该目录已经存在，不要重复克隆。确认没有未提交修改后更新：

```bash
git -C /Users/dmeck/project/boss-agent status --short
git -C /Users/dmeck/project/boss-agent pull --ff-only
cd /Users/dmeck/project/boss-agent
bun install
```

之后在 Codex 中打开 `/Users/dmeck/project/boss-agent` 作为任务工作目录。三个 Prompt 会读取这个项目中的脚本、配置、进度文件和简历上下文。

## 运行 Prompt 任务

任务包位于 `/Users/dmeck/project/boss-agent/docs/`。每个文件都是外层 ZIP，里面还有一个 `Part-1.zip`，真正的 Prompt 是内层 Markdown；让 Codex 完整解压并读取，不要只看 ZIP 文件名。

推荐按以下顺序执行：

| 顺序 | Prompt 任务 | 文件 |
| --- | --- | --- |
| 1 | 简历投递批量处理 | `docs/9cd6133d-45d1-4184-9981-bacce2685449_ExportBlock-c242f613-5ade-46be-add3-3777d639d352.zip` |
| 2 | 与 BOSS 沟通获得面试机会 | `docs/56352147-341a-4d7d-97d1-a56e69e93f9b_ExportBlock-ac15ed3a-0e59-466f-8e8d-b532cff91020.zip` |
| 3 | 沟通进度数据摘要收集到飞书 | `docs/0bdbbc7c-30c4-4794-8fbc-49075ee96088_ExportBlock-d2fe6b20-1623-40bf-9bcb-263dd0f4ad19.zip` |

在 Codex 中新建任务，使用下面的启动 Prompt，并替换任务包路径：

```text
工作目录使用 /Users/dmeck/project/boss-agent。

读取指定的 Prompt 任务包：
/Users/dmeck/project/boss-agent/docs/<任务包文件名>.zip

这个外层 ZIP 中包含 Part-1.zip。请继续读取内层 ZIP 中的 Markdown，完整理解其中的目标、工具约束、每轮规划协议、进度记录和停止条件。

先向我汇总本任务将进行的浏览器操作、消息发送、简历投递、日历或飞书写入等外部动作。得到我的确认后，再严格使用 Boss投递（@chrome-dev）执行；如果 Boss投递未连接，立即停止，不得改用 Playwright、agent-browser 或其他浏览器工具。
```

这些 Prompt 会产生真实的岗位沟通、简历投递、日历或飞书数据写入。首次运行建议先检查任务正文和当前登录账号，再明确允许执行的动作与数量。

> `boss-agent-run-job` 中也包含 Bun/agent-browser 轨迹脚本，但它们不是这三个 Prompt 任务的浏览器替代入口。三个任务已经明确要求使用 Boss投递 `@chrome-dev`；连接失败时必须停止。

## 使用前准备

1. 按照 [安装说明](docs/manual-install.md) 完成 Boss投递安装。
2. 在 Chrome 中登录 BOSS 直聘。
3. 打开需要处理的岗位列表、职位详情或聊天页面。
4. 确认 Chrome 已启用“Boss投递”扩展。

如果页面顶部显示“Boss投递已开始调试此浏览器”，说明插件已经取得当前浏览器的控制权限。

![Boss投递连接到 BOSS 直聘页面](docs/images/boss-delivery-chrome-connected.png)

## 第一次使用

建议先执行一次只读测试。在 Codex 中输入：

```text
使用 Boss投递检查当前 BOSS 直聘页面，并汇总可见岗位信息。只读取，不发起沟通或投递。
```

正常情况下，Codex 会返回当前页面、可见岗位数量以及岗位摘要。如果插件未连接、BOSS 未登录或没有当前页面权限，任务应该停止并说明原因。

## 常用方法

### 汇总当前岗位

```text
使用 Boss投递读取当前页面的可见岗位，整理岗位名称、公司、地点、薪资、经验要求和职位亮点。不要发送消息或投递简历。
```

### 按条件筛选

```text
使用 Boss投递搜索“AI 产品经理”，地点杭州。按照岗位匹配度、薪资、经验要求和公司情况生成候选清单，先不要投递。
```

### 根据简历判断匹配度

```text
读取我指定的简历，只提取和求职相关的信息。对当前候选岗位逐一判断匹配度，并说明匹配理由、缺口和建议优先级。不要发送或投递。
```

### 草拟沟通消息

```text
为前三个候选岗位分别草拟一条沟通消息。展示岗位、匹配理由和消息正文，等待我确认后再进行任何发送。
```

## 批量处理

批量处理时，建议让 Codex 分成“读取、筛选、草拟、确认、执行”五个阶段，并限制每轮处理数量。

```text
使用 Boss投递扫描当前搜索结果，每轮最多处理 10 个岗位。先生成候选清单，再为符合条件的岗位草拟沟通消息。没有得到我的明确确认前，不要点击发送或投递。
```

Codex 会在同一个任务中展示 Chrome 操作、岗位处理进度和当前结果：

![Codex 使用 Boss投递批量处理岗位](docs/images/boss-delivery-codex-batch.png)

## 定时任务

可以使用 Codex 定时任务定期汇总岗位或沟通进度。建议定时任务默认只读取和整理，不自动发送消息或投递简历。

```text
每天 20:15 使用 Boss投递汇总今天已沟通岗位的可见进度，只生成摘要，不发送消息、不投递简历。如果 Chrome 未连接或 BOSS 未登录，记录原因后停止。
```

![使用 Codex 定时任务运行 Boss 工作流](docs/images/boss-delivery-scheduled-tasks.png)

## 发送或投递前

需要产生外部影响时，请确认：

- 目标岗位是否正确；
- 使用的简历是否正确；
- 消息正文是否符合你的真实经历；
- 本轮允许发送或投递的数量；
- 是否存在重复沟通或重复投递。

页面没有额外确认按钮，并不表示可以跳过 Codex 中的人工确认。

## 插件连接不上

先在 Codex 输入：

```text
检查 Boss投递 Chrome 扩展是否已连接。只进行检查，不操作 BOSS 页面；如果失败，请说明失败在哪一步并给出修复方法。
```

仍然失败时：

1. 打开 `chrome://extensions/`，确认 Boss投递已启用；
2. 点击 Boss投递卡片上的“重新加载”；
3. 刷新 BOSS 页面后重新执行只读测试；
4. 按 [安装说明中的常见故障](docs/manual-install.md#八常见故障) 继续检查。

如果 Boss投递不可用，不要让任务自动改用其他浏览器工具继续操作。

## 使用原则

- 默认先读取、筛选和草拟，再确认是否执行；
- 不要让生成的沟通内容虚构工作经历或技能；
- 批量任务应限制数量，并记录已经处理的岗位；
- 遇到登录、验证码、风控或页面结构异常时停止操作；
- 使用时应遵守 BOSS 直聘的服务规则和适用法律。

## 相关内容

- [本地安装与排障](docs/manual-install.md)
- [项目完整开发过程与复线](docs/development-history.md)
- [开发类似 Chrome 自动化插件](docs/plugin-development-guide.md)
- [Notion「Boss」项目](https://app.notion.com/p/Boss-38d30b7547c380478319d3d5d6812ac3?source=copy_link)
