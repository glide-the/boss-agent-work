import type { NativeHostStatus } from './messages';

export interface LocalStorageSchema {
  NATIVE_HOST_STATUS?: NativeHostStatus;
  extensionInstanceId?: string;
}

export interface SessionStorageSchema {
  codexPendingUpdateVersion?: string;
  codexSidePanelOpenWindowIds?: number[];
  TAB_LEASES?: unknown;
  TAB_GROUPS?: unknown;
  TAB_FAVICON_BADGES?: unknown;
}
