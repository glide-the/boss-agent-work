import { FAVICON_BADGE_MARKER } from '../shared/constants';
import type { FaviconBadgeState } from '../types/messages';

const BADGE_LINK_SELECTOR = 'link[data-codex-favicon-badge="true"]';
const ICON_LINK_SELECTOR = 'link[rel~="icon"], link[rel="shortcut icon"]';
const CREATED_DATA_KEY = 'codexFaviconBadgeCreated';
const ORIGINAL_HREF_DATA_KEY = 'codexOriginalFaviconHref';

type TrackedIcon = {
  link: HTMLLinkElement;
  originalHref: string | null;
  badgedHref: string;
  createdByCodex: boolean;
};

let trackedIcons: TrackedIcon[] = [];

export function setFaviconBadge(badge: FaviconBadgeState, faviconDataUrl: string | null): void {
  clearFaviconBadge();
  if (badge == null || faviconDataUrl == null) return;
  const badgedHref = makeBadgeDataUrl(badge, faviconDataUrl);
  const existing = [...document.querySelectorAll<HTMLLinkElement>(ICON_LINK_SELECTOR)];
  trackedIcons = existing.length > 0
    ? existing.map((link) => ({ link, originalHref: link.getAttribute('href'), badgedHref, createdByCodex: false }))
    : [{ link: createIconLink(), originalHref: null, badgedHref, createdByCodex: true }];
  for (const item of trackedIcons) applyTrackedIcon(item);
}

export function clearFaviconBadge(): void {
  const old = trackedIcons;
  trackedIcons = [];
  for (const item of old) restoreTrackedIcon(item);
  for (const link of document.querySelectorAll<HTMLLinkElement>(BADGE_LINK_SELECTOR)) {
    const created = link.dataset[CREATED_DATA_KEY] === 'true';
    const originalHref = link.dataset[ORIGINAL_HREF_DATA_KEY] ?? null;
    restoreLink(link, created, originalHref);
  }
}

function createIconLink(): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'icon';
  ensureHead().appendChild(link);
  return link;
}

function applyTrackedIcon(item: TrackedIcon): void {
  item.link.href = item.badgedHref;
  item.link.dataset.codexFaviconBadge = 'true';
  item.link.dataset[CREATED_DATA_KEY] = String(item.createdByCodex);
  if (item.originalHref) item.link.dataset[ORIGINAL_HREF_DATA_KEY] = item.originalHref;
}

function restoreTrackedIcon(item: TrackedIcon): void {
  restoreLink(item.link, item.createdByCodex, item.originalHref);
}

function restoreLink(link: HTMLLinkElement, createdByCodex: boolean, originalHref: string | null): void {
  delete link.dataset.codexFaviconBadge;
  delete link.dataset[CREATED_DATA_KEY];
  delete link.dataset[ORIGINAL_HREF_DATA_KEY];
  if (createdByCodex) link.remove();
  else if (originalHref == null) link.removeAttribute('href');
  else link.href = originalHref;
}

function ensureHead(): HTMLHeadElement {
  if (document.head) return document.head;
  const head = document.createElement('head');
  document.documentElement.prepend(head);
  return head;
}

function makeBadgeDataUrl(badge: Exclude<FaviconBadgeState, null>, faviconDataUrl: string): string {
  const color = badge === 'active' ? '#22c55e' : '#facc15';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-codex-favicon-badge="${FAVICON_BADGE_MARKER}" width="32" height="32"><image href="${faviconDataUrl}" width="32" height="32"/><circle cx="24" cy="24" r="7" fill="${color}" stroke="black" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
