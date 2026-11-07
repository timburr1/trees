import { useClock } from '../hooks/useClock.ts';
import { useStore } from '../hooks/useStore.ts';
import { sessionResolve } from '../lib/session-resolve.ts';
import { selectResultPending, type StoreApp } from '../lib/store-app.ts';
import { FocusResult } from './FocusResult.tsx';
import { FocusRunning } from './FocusRunning.tsx';
import { FocusSetup, type FocusSetupChoice } from './FocusSetup.tsx';

/** Selects the whole state itself: it changes every second during a session, and nothing above this screen should re-render with it. */
export function FocusScreen({
  store,
  choice,
  onChoiceChange,
}: {
  store: StoreApp;
  choice: FocusSetupChoice;
  onChoiceChange: (choice: FocusSetupChoice) => void;
}) {
  const state = useStore(store, (current) => current);
  const now = useClock(1000);
  const pending = selectResultPending(state);
  if (state.data.active) {
    // Display from the resolved session, so a pause that expired while nothing ran never shows as paused.
    return <FocusRunning store={store} active={sessionResolve(state.data.active, now).active} now={now} />;
  }
  if (pending) {
    return <FocusResult store={store} session={pending} />;
  }
  return <FocusSetup store={store} state={state} choice={choice} onChoiceChange={onChoiceChange} />;
}
