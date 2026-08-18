import { describe, expect, test } from "bun:test";

import { BrowserTabs } from "../runtime/tabs.ts";

describe("BrowserTabs semantic reconstruction", () => {
  test("delegates create, list, finalize, and mark", async () => {
    const calls: unknown[] = [];
    const tabs = new BrowserTabs(
      {
        createTab(windowId) {
          calls.push(["create", windowId]);
          return { id: 3 };
        },
        getTabs() {
          calls.push(["list"]);
          return [{ id: 3, active: true }];
        },
        finalizeTabs(tabIds) {
          calls.push(["finalize", tabIds]);
        },
        markTab(tabId, mark) {
          calls.push(["mark", tabId, mark]);
        },
      },
      11,
    );
    expect(await tabs.create()).toEqual({ id: 3 });
    expect(await tabs.getActive()).toEqual({ id: 3, active: true });
    await tabs.finalize([3]);
    await tabs.mark(3, "handoff");
    expect(calls).toEqual([
      ["create", 11],
      ["list"],
      ["finalize", [3]],
      ["mark", 3, "handoff"],
    ]);
  });

  test("preserves missing-tab diagnostics", async () => {
    const tabs = new BrowserTabs(
      {
        createTab: () => ({ id: 1 }),
        getTabs: () => [{ id: 1, title: "One", url: "https://one.test" }],
        finalizeTabs: () => {},
        markTab: () => {},
      },
      undefined,
    );
    await expect(tabs.get(9)).rejects.toThrow(
      "Tab not found: 9. Existing tabs: 1|One|https://one.test",
    );
  });
});
