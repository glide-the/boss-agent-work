import { PENDING_UPDATE_VERSION_KEY } from '../shared/constants';

export class ExtensionUpdateReloader {
  private pendingUpdateVersion: string | null = null;
  private reloadInProgress = false;

  constructor(private readonly isInUse: () => boolean) {}

  register(): void {
    chrome.runtime.onUpdateAvailable.addListener((details: { version: string }) => {
      void this.handleUpdateAvailable(details);
    });
    void this.maybeReloadForPendingUpdate();
  }

  async maybeReloadForPendingUpdate(): Promise<void> {
    if (this.reloadInProgress) return;
    if (this.pendingUpdateVersion == null) await this.restorePendingUpdate();
    if (this.pendingUpdateVersion != null && !this.isInUse()) {
      this.reloadInProgress = true;
      await this.clearPendingUpdate();
      chrome.runtime.reload();
    }
  }

  private async handleUpdateAvailable(details: { version: string }): Promise<void> {
    this.pendingUpdateVersion = details.version;
    await chrome.storage.session.set({ [PENDING_UPDATE_VERSION_KEY]: details.version });
    await this.maybeReloadForPendingUpdate();
  }

  private async restorePendingUpdate(): Promise<void> {
    const result = await chrome.storage.session.get(PENDING_UPDATE_VERSION_KEY);
    const version = result[PENDING_UPDATE_VERSION_KEY];
    this.pendingUpdateVersion = typeof version === 'string' ? version : null;
  }

  private async clearPendingUpdate(): Promise<void> {
    this.pendingUpdateVersion = null;
    await chrome.storage.session.remove(PENDING_UPDATE_VERSION_KEY);
  }
}
