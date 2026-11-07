import { FocusScreen } from './components/FocusScreen.tsx';
import { OwnerBlocked } from './components/OwnerBlocked.tsx';
import { SessionsBlocked } from './components/SessionsBlocked.tsx';
import { StatusBanner } from './components/StatusBanner.tsx';
import { StorageUnavailable } from './components/StorageUnavailable.tsx';
import { useApp } from './hooks/useApp.ts';
import { useSessionRunner } from './hooks/useSessionRunner.ts';
import { useStore } from './hooks/useStore.ts';
import type { StoreApp } from './lib/store-app.ts';
import type { AppController } from './platform/app-controller.ts';

function AppReady({ store }: { store: StoreApp }) {
  const state = useStore(store, (current) => current);
  useSessionRunner(store);
  return (
    <>
      <StatusBanner store={store} status={state.status} />
      {state.sessionsBlocked ? <SessionsBlocked raw={state.guard.corrupt.sessions ?? ''} /> : <FocusScreen store={store} state={state} />}
    </>
  );
}

export function App({ controller }: { controller: AppController }) {
  const status = useApp(controller);
  return (
    <main className="mx-auto max-w-xl p-6">
      <AppStatusView status={status} controller={controller} />
    </main>
  );
}

function AppStatusView({ status, controller }: { status: ReturnType<typeof useApp>; controller: AppController }) {
  switch (status.kind) {
    case 'starting':
      return <p className="text-muted">Loading</p>;
    case 'other':
      return <OwnerBlocked onUseHere={() => void controller.steal()} />;
    case 'failed':
      return (
        <section className="space-y-3" role="alert">
          <h1 className="text-xl font-semibold">Trees could not start</h1>
          <p className="text-sm text-muted">{status.error instanceof Error ? status.error.message : String(status.error)}</p>
        </section>
      );
    case 'storage-unavailable':
      return <StorageUnavailable error={status.error} />;
    case 'ready':
      return <AppReady store={status.store} />;
    default:
      throw new Error(`Unhandled app status: ${JSON.stringify(status satisfies never)}`);
  }
}
