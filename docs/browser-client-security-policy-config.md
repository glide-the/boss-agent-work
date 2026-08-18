# Browser Client 策略配置（Site Status 与 Origin）

本文单独说明 Boss投递 Browser Client 的源码级安全策略、环境变量兼容边界和构建验证方式。安装流程仍见 [本地手动安装说明](manual-install.md)。

## 一、适用范围

本文只说明 Browser Client 的 Site Status 与 Origin 授权配置。两个开关共享同一个源码事实源，必须在下一节一起维护；它们不由某个任务生成的 `~/.codex/browser/sessions/*.toml` 覆盖。

关闭 Origin 授权不等于关闭全部 Browser Security。以下边界继续独立执行：

- HTTP/HTTPS、URL 结构和基础目标 URL 校验；
- managed Codex network policy，并在策略读取无效或缺少特权客户端时 fail-closed；
- 文件传输授权；
- full CDP 授权；
- history consent；
- Chrome Extension、Native Host 和 Browser Client 的身份及协议校验。

## 二、Site Status 配置（通常不需要）

Site Status 与 Origin 授权必须一起理解和配置。它们共享同一个源码事实源，但控制两条独立的检查链：`siteStatus` 控制可选站点状态服务，`originAuthorization` 控制 Origin consent。当前生产配置同时关闭两者：

```text
components/codex-plugin/src/browser-client/security/policy-config.ts
```

```ts
export const BROWSER_CLIENT_SECURITY_POLICY = Object.freeze({
  siteStatus: "disabled",
  originAuthorization: "disabled",
});
```

| 配置 | 当前值 | 运行时结果 |
| --- | --- | --- |
| `siteStatus` | `disabled` | 不请求本地或远程 `/aura/site_status`；相关环境变量会在 Browser Client 接线层被过滤 |
| `originAuthorization` | `disabled` | 不读取 Origin allow/deny 作为授权结论，不弹出 Origin 授权，不写入 Origin 接受或拒绝记录 |

修改任一开关后都必须使用 Bun 重新构建、验证并部署。直接编辑生成的 `scripts/browser-client.mjs` 不属于受支持的配置方式。

Boss投递当前在源码策略层固定设置 `siteStatus: "disabled"`。正常安装不需要配置环境变量，也不会请求 ChatGPT 或本地服务的 `site_status` 接口。即使桌面应用环境中存在以下旧配置，当前 canonical Browser Client 也会过滤它们：

```text
BROWSER_USE_SITE_STATUS_CHECK_ENABLED
BROWSER_USE_SITE_STATUS_BASE_URL
```

保留这些变量和本地服务实现是为了兼容已有开发夹具及将来的显式测试，不表示生产构建会自动启用它们。

### 开发环境显式启用

只有需要验证兼容服务的开发者，才应先把 `policy-config.ts` 中的 `siteStatus` 改为 `"enabled"`，然后设置：

```bash
launchctl setenv BROWSER_USE_SITE_STATUS_CHECK_ENABLED true
launchctl setenv BROWSER_USE_SITE_STATUS_BASE_URL http://127.0.0.1:8787
```

完全退出并重新打开 Codex/ChatGPT Desktop 后，兼容服务必须实现：

```http
GET /aura/site_status?site_url=...&url_request_source=...
```

允许时返回：

```json
{"feature_status":{"agent":true}}
```

阻止时返回：

```json
{"feature_status":{"agent":false}}
```

启用后的兼容行为仍受以下约束：

- 服务地址只允许 `127.0.0.1`、`localhost`、`*.localhost`、`[::1]` 或 `::1`；
- 不存在 ChatGPT `site_status` 远程回退；
- 超时、连接失败、非 2xx、无效 JSON 或缺少字段时记录脱敏诊断并 fail-open；
- `feature_status.agent === false` 时保留阻止结果；
- 不要使用 `BROWSER_USE_SECURITY_MODE=disabled-for-local-testing`，它会影响多项无关安全检查。

测试完成后清理环境变量，并把源码策略恢复为 `"disabled"`：

```bash
launchctl unsetenv BROWSER_USE_SITE_STATUS_CHECK_ENABLED
launchctl unsetenv BROWSER_USE_SITE_STATUS_BASE_URL
```

### Origin 授权（与 Site Status 同一策略层）

当前 `originAuthorization: "disabled"` 的含义是跳过 Origin consent 层，而不是把任意网络访问都视为允许：

1. 不使用 session/global TOML 中的 Origin allow/deny 决定请求；
2. 不向用户发起 Origin elicitation；
3. 不为 Origin 接受或拒绝结果写入 TOML；
4. 仍先执行 managed Codex network policy；该策略拒绝时请求仍被拒绝；
5. 文件传输、full CDP 和 history consent 不随此开关关闭。

因此，淘宝任务或飞书任务生成的 session TOML 不会在当前配置下触发 Origin 授权，但共享的 managed network policy 仍可能影响不同网站。这一区分用于避免把“无需 Origin 授权”误解为“关闭所有网络安全策略”。

如需重新启用 Origin 授权，只修改源码事实源中的 `originAuthorization` 为 `"enabled"`，然后完整执行下一节的构建和验证。不要只修改某个 session TOML，也不要直接修改 bundle。

## 三、构建、验证与部署

从唯一生产源码目录执行：

```bash
cd /Users/dmeck/project/boss-agent-work/develop/components/codex-plugin/src/browser-client

bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run verify
bun run deploy
bun run verify:deployed
```

生成物保持在：

```text
components/codex-plugin/scripts/browser-client.mjs
```

`deploy` 会先校验不可变 `components/codex-plugin/scripts-bak` 基线和差分门禁，再原子替换 `scripts`。需要回退时执行：

```bash
bun run rollback
```

修改策略后还应在工程根目录执行：

```bash
make all
make verify
```

真实 Chrome 或外部网站验证仍需单独获得授权；静态、Mock 和 bundle 差分通过不能被描述为真实浏览器测试通过。

## 四、兼容性约定

- 安装手册继续保留 `## 二、Site Status 配置（通常不需要）` 标题，旧锚点不变；详细行为以本文为准。
- `site-status-policy.ts` 及旧环境变量继续保留，以支持隔离测试和显式开发模式。
- canonical 构建只读取 `src/browser-client`，不从 `scripts`、插件 cache 或临时目录反向取源。
- Chrome Extension ID、Native Host 名称、消息协议和 `/aura/identity` 不受这两个策略开关影响。
