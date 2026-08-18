/**
 * Canonical source-level Browser Client security switches.
 *
 * These switches intentionally live in source control instead of mutable
 * `~/.codex/browser` state so every Bun build has the same policy behavior.
 * URL scheme/host validation, managed Codex network policy, file-transfer
 * consent and full-CDP consent remain separate controls.
 */
export interface BrowserClientSecurityPolicyConfig {
  readonly siteStatus: "enabled" | "disabled";
  readonly originAuthorization: "enabled" | "disabled";
}

export const BROWSER_CLIENT_SECURITY_POLICY: BrowserClientSecurityPolicyConfig =
  Object.freeze({
    siteStatus: "disabled",
    originAuthorization: "disabled",
  });

export function siteStatusEnvironment(
  runtimeEnvironment: Record<string, unknown> = {},
): Record<string, unknown> {
  return BROWSER_CLIENT_SECURITY_POLICY.siteStatus === "enabled"
    ? runtimeEnvironment
    : {};
}
