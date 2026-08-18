# 安全边界

- 输入只读；不修改 `scripts-bak`。
- `reproduce` 只写当前 reconstruction 的 `artifacts`。
- 不连接 Chrome、Native Host、外部网站或远程服务。
- 不修改本机 Codex cache、marketplace、Chrome 注册或 Native Messaging manifest。
- 便携打包只允许写显式 `--output`；覆盖已有目录必须显式 `--force`。
- artifacts 可能包含错误文本、协议名和路径，但不得收集环境变量值、Cookie、Token 或页面内容。
