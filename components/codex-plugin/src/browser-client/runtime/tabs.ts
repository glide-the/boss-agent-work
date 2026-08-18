export interface BrowserTabRecord {
  id: number;
  active?: boolean;
  title?: string | null;
  url?: string | null;
}

export interface BrowserTabsAdapter {
  createTab(preferredWindowId: unknown): Promise<BrowserTabRecord> | BrowserTabRecord;
  getTabs(): Promise<BrowserTabRecord[]> | BrowserTabRecord[];
  finalizeTabs(tabIds: unknown): Promise<void> | void;
  markTab(tabId: unknown, mark: unknown): Promise<void> | void;
}

/**
 * Semantic reconstruction of baseline local `ep`.
 * Evidence: scripts-bak/browser-client.mjs, formatted lines 37632-37669.
 */
export class BrowserTabs {
  constructor(
    private readonly api: BrowserTabsAdapter,
    private readonly preferredWindowId: unknown,
  ) {}

  async create(): Promise<BrowserTabRecord> {
    return await this.api.createTab(this.preferredWindowId);
  }

  async list(): Promise<BrowserTabRecord[]> {
    return await this.api.getTabs();
  }

  async finalize(tabIds: unknown): Promise<void> {
    await this.api.finalizeTabs(tabIds);
  }

  async mark(tabId: unknown, mark: unknown): Promise<void> {
    await this.api.markTab(tabId, mark);
  }

  async get(tabId: number): Promise<BrowserTabRecord> {
    const tabs = await this.list();
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (tab == null) {
      const existingTabs = tabs.length
        ? tabs
            .map(
              (candidate) =>
                `${candidate.id}|${candidate.title ?? "<no title>"}|${candidate.url ?? "<no url>"}`,
            )
            .join(", ")
        : "none";
      throw new Error(`Tab not found: ${tabId}. Existing tabs: ${existingTabs}`);
    }
    return tab;
  }

  async getActive(): Promise<BrowserTabRecord> {
    const activeTab = (await this.list()).find((tab) => tab.active);
    if (activeTab == null) throw new Error("No active tab found");
    return activeTab;
  }
}
