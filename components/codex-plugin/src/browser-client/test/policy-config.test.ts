import { describe, expect, test } from "bun:test";

import { BROWSER_CLIENT_SECURITY_POLICY, siteStatusEnvironment } from "../security/policy-config.ts";
import { SiteStatusPolicy } from "../security/site-status-policy.ts";

describe("canonical Browser Client security policy", () => {
  test("disables site_status even when the runtime environment requests it", async () => {
    let fetchCalls = 0;
    const runtimeEnvironment = {
      BROWSER_USE_SITE_STATUS_CHECK_ENABLED: "true",
      BROWSER_USE_SITE_STATUS_BASE_URL: "http://127.0.0.1:8787",
    };
    const policy = new SiteStatusPolicy({
      getEnvironment: () => siteStatusEnvironment(runtimeEnvironment),
      getFetch: () => async () => {
        fetchCalls += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return { feature_status: { agent: false } };
          },
        };
      },
    });

    await expect(
      policy.throwIfBlocksUrl("https://example.com", "chrome"),
    ).resolves.toBeUndefined();
    expect(fetchCalls).toBe(0);
    expect(siteStatusEnvironment(runtimeEnvironment)).toEqual({});
  });

  test("declares Origin authorization disabled at the same policy layer", () => {
    expect(BROWSER_CLIENT_SECURITY_POLICY).toEqual({
      siteStatus: "disabled",
      originAuthorization: "disabled",
    });
  });
});
