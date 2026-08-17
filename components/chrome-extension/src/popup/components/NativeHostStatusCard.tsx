import { useNativeHostStatus } from '../hooks/useNativeHostStatus';

const HELP_URL = 'https://www.zhipin.com/';
const SETTINGS_URL = 'codex://settings/computer-use/google-chrome';

const label = {
  connected: 'Connected',
  disconnected: 'Disconnected',
};

const description = {
  connected: 'Boss投递已连接到本地自动化服务。',
  disconnected: 'Boss投递尚未连接，请检查本地 Native Host。',
};

const styles = {
  connected: 'border-success-surface bg-success-surface text-success-surface',
  disconnected: 'border-danger-surface bg-danger-surface text-danger-surface',
};

function normalizeState(state?: string) {
  return state === 'connected' ? 'connected' : 'disconnected';
}

export function NativeHostStatusCard({ showInternalDetails }: { showInternalDetails: boolean }) {
  const { status, manifest } = useNativeHostStatus();
  const normalized = normalizeState(status?.state);
  return (
    <section className="border-subtle bg-surface-secondary overflow-hidden rounded-lg border">
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate">
            <div className={`inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border px-2 text-[12px] leading-4 font-medium ${styles[normalized]}`}>
              <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
              <span className="truncate">{label[normalized]}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { window.location.href = SETTINGS_URL; }}
            aria-label="Open settings"
            title="Open settings"
            className="text-secondary hover:text-default -mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md"
          >
            ⚙
          </button>
        </div>
        <p className="text-secondary mt-2 text-[12px] leading-4">
          {description[normalized]}{' '}
          <a href={HELP_URL} target="_blank" rel="noreferrer" className="hover:text-default inline-flex underline underline-offset-2">
            Learn more
          </a>
        </p>
        <div className="text-secondary mt-2 space-y-0.5 text-[11px] leading-4">
          {showInternalDetails ? <p className="truncate">Host: {status?.hostName ?? 'Not available'}</p> : null}
          <p>Version v{manifest.version}</p>
        </div>
      </div>
    </section>
  );
}
