import { NativeHostStatusCard } from './components/NativeHostStatusCard';
import { OpenSidePanelButton } from './components/OpenSidePanelButton';

const SHOW_SIDE_PANEL_BUTTON = true;
const SHOW_INTERNAL_DETAILS = true;

export function App() {
  return (
    <main className="bg-surface text-default w-[360px] p-4">
      <div className="space-y-3">
        <header className="px-2 pt-1 pb-2 text-center">
          <div className="flex justify-center">
            <span aria-hidden="true" className="codex-popup-logo text-default block size-7 bg-current" />
          </div>
          <h1 className="mt-3 text-[16px] leading-5 font-medium">Boss投递</h1>
        </header>
        {SHOW_SIDE_PANEL_BUTTON ? <OpenSidePanelButton /> : null}
        <NativeHostStatusCard showInternalDetails={SHOW_INTERNAL_DETAILS} />
      </div>
    </main>
  );
}
