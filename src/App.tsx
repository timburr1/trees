import { useState } from 'react';
import { FocusScreen } from './components/FocusScreen.tsx';
import type { FocusSetupChoice } from './components/FocusSetup.tsx';
import { ForestScreen } from './components/ForestScreen.tsx';
import { SettingsScreen } from './components/SettingsScreen.tsx';
import { ShopScreen } from './components/ShopScreen.tsx';
import { StatsScreen } from './components/StatsScreen.tsx';
import { NavBar, type FocusIndicator, type Screen } from './components/NavBar.tsx';
import { OwnerBlocked } from './components/OwnerBlocked.tsx';
import { SessionsBlocked } from './components/SessionsBlocked.tsx';
import { StatusBanner } from './components/StatusBanner.tsx';
import { StorageUnavailable } from './components/StorageUnavailable.tsx';
import { UpdatePrompt } from './components/UpdatePrompt.tsx';
import { useApp } from './hooks/useApp.ts';
import { useSessionRunner } from './hooks/useSessionRunner.ts';
import { useStore } from './hooks/useStore.ts';
import { speciesStarter } from './lib/species-catalog.ts';
import { selectResultPending, selectUpdateBlock, type StoreApp } from './lib/store-app.ts';
import type { AppController } from './platform/app-controller.ts';
import type { AppUpdate } from './platform/app-update.ts';
import type { SyncController } from './platform/sync-controller.ts';
import { fileSave as fileSaveReal, type FileSave } from './platform/file-save.ts';

const fileSave: FileSave = (name, text) => fileSaveReal(name, text, (message) => console.warn(`[trees] ${message}`));

function ScreenView({
  screen,
  store,
  choice,
  onChoiceChange,
  sync,
}: {
  screen: Screen;
  store: StoreApp;
  sync: SyncController;
  choice: FocusSetupChoice;
  onChoiceChange: (choice: FocusSetupChoice) => void;
}) {
  switch (screen) {
    case 'focus':
      return <FocusScreen store={store} choice={choice} onChoiceChange={onChoiceChange} />;
    case 'forest':
      return <ForestScreen store={store} />;
    case 'stats':
      return <StatsScreen store={store} />;
    case 'shop':
      return <ShopScreen store={store} />;
    case 'settings':
      return <SettingsScreen store={store} fileSave={fileSave} sync={sync} />;
    default:
      throw new Error(`Unhandled screen: ${String(screen satisfies never)}`);
  }
}

// Selects only what the frame needs, so the per-second session ticks re-render the Focus screen and nothing else.
function AppReady({ store, update, sync }: { store: StoreApp; update: AppUpdate; sync: SyncController }) {
  const status = useStore(store, (state) => state.status);
  const sessionsBlocked = useStore(store, (state) => state.sessionsBlocked);
  const running = useStore(store, (state) => state.data.active !== undefined);
  const resultReady = useStore(store, (state) => selectResultPending(state) !== undefined);
  const updateBlock = useStore(store, selectUpdateBlock);
  const [screen, setScreen] = useState<Screen>('focus');
  const [choice, setChoice] = useState<FocusSetupChoice>({ mode: 'countdown', speciesId: speciesStarter.id, durationMs: undefined, tagId: undefined });
  useSessionRunner(store);
  if (sessionsBlocked) {
    return (
      <>
        <UpdatePrompt update={update} block={updateBlock} />
        <StatusBanner store={store} status={status} />
        <SessionsBlocked store={store} fileSave={fileSave} sync={sync} />
      </>
    );
  }
  const focusIndicator: FocusIndicator = running ? 'running' : resultReady ? 'result' : 'idle';
  return (
    <>
      <UpdatePrompt update={update} block={updateBlock} />
      <StatusBanner store={store} status={status} />
      <div className="flex-1">
        <ScreenView screen={screen} store={store} choice={choice} onChoiceChange={setChoice} sync={sync} />
      </div>
      <NavBar screen={screen} focusIndicator={focusIndicator} onNavigate={setScreen} />
    </>
  );
}

export function App({ controller, update, sync }: { controller: AppController; update: AppUpdate; sync: SyncController }) {
  const status = useApp(controller);
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col p-6">
      <AppStatusView status={status} controller={controller} update={update} sync={sync} />
    </main>
  );
}

function AppStatusView({
  status,
  controller,
  update,
  sync,
}: {
  status: ReturnType<typeof useApp>;
  controller: AppController;
  update: AppUpdate;
  sync: SyncController;
}) {
  switch (status.kind) {
    case 'starting':
      return <p className="text-muted">Loading</p>;
    case 'other':
      return <OwnerBlocked onUseHere={() => void controller.steal()} />;
    case 'failed':
      return (
        <>
          <UpdatePrompt update={update} block={undefined} />
          <section className="space-y-3" role="alert">
            <h1 className="text-xl font-semibold">Trees could not start</h1>
            <p className="text-sm text-muted">{status.error instanceof Error ? status.error.message : String(status.error)}</p>
          </section>
        </>
      );
    case 'storage-unavailable':
      return (
        <>
          <UpdatePrompt update={update} block={undefined} />
          <StorageUnavailable error={status.error} />
        </>
      );
    case 'ready':
      return <AppReady store={status.store} update={update} sync={sync} />;
    default:
      throw new Error(`Unhandled app status: ${JSON.stringify(status satisfies never)}`);
  }
}
