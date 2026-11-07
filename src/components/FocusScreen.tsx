import { useClock } from '../hooks/useClock.ts';
import { sessionResolve } from '../lib/session-resolve.ts';
import { selectResultPending, type AppState, type StoreApp } from '../lib/store-app.ts';
import { FocusResult } from './FocusResult.tsx';
import { FocusRunning } from './FocusRunning.tsx';
import { FocusSetup } from './FocusSetup.tsx';

export function FocusScreen({ store, state }: { store: StoreApp; state: AppState }) {
  const now = useClock(1000);
  const pending = selectResultPending(state);
  if (state.data.active) {
    // Display from the resolved session, so a pause that expired while nothing ran never shows as paused.
    return <FocusRunning store={store} active={sessionResolve(state.data.active, now).active} now={now} />;
  }
  if (pending) {
    return <FocusResult store={store} session={pending} />;
  }
  return <FocusSetup store={store} state={state} />;
}
