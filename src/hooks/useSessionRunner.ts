import { useEffect } from 'react';
import { chimeDue, sessionClockText } from '../lib/session-clock.ts';
import { sessionResolve } from '../lib/session-resolve.ts';
import type { StoreApp } from '../lib/store-app.ts';
import { chimePlay } from '../platform/chime.ts';
import { wakeLockMake } from '../platform/wake-lock.ts';
import { useStore } from './useStore.ts';

const TITLE_IDLE = 'Trees';

/** Keeps a running session alive: reports presence to the store, holds the screen awake, plays the finish chime, and mirrors the clock into the tab title. */
export function useSessionRunner(store: StoreApp): void {
  const sessionId = useStore(store, (state) => state.data.active?.id);
  // A blocked store ignores session actions, so a stored session could never finish: do not hold the screen awake for it.
  const blocked = useStore(store, (state) => state.sessionsBlocked);
  const hasSession = sessionId !== undefined && !blocked;

  // Each callback reads `store.getState()` when it runs, so this effect depends only on whether a session is running and not on every state change.
  useEffect(() => {
    if (!hasSession) {
      return;
    }
    const warn = (message: string) => store.statusSet({ code: 'sound', severity: 'warning', message, blocking: false });
    const touch = (seen: boolean) => {
      const now = Date.now();
      const result = store.sessionDispatch({ kind: 'sessionTouch', now, seen });
      if (chimeDue(result?.finished, now)) {
        chimePlay(warn);
      }
      const raw = store.getState().data.active;
      if (!raw) {
        document.title = TITLE_IDLE;
        return;
      }
      const { active } = sessionResolve(raw, now);
      document.title = `${sessionClockText(active, now)} · ${TITLE_IDLE}`;
    };
    const visible = () => document.visibilityState === 'visible';
    // Both directions of a visibility change are "seen": hiding records when the user left, and showing runs after settling, so a strict session that overstayed the grace period has already failed.
    const onVisibility = () => touch(true);
    const onPresence = () => touch(visible());
    const onPageHide = () => touch(true);
    const interval = setInterval(onPresence, 1000);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('resume', onPresence);
    window.addEventListener('pageshow', onPresence);
    window.addEventListener('focus', onPresence);
    window.addEventListener('pagehide', onPageHide);
    touch(visible());
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('resume', onPresence);
      window.removeEventListener('pageshow', onPresence);
      window.removeEventListener('focus', onPresence);
      window.removeEventListener('pagehide', onPageHide);
      document.title = TITLE_IDLE;
    };
  }, [store, hasSession]);

  // Held through pauses too, so a phone does not lock mid-pause and then fail a strict session by leaving.
  useEffect(() => {
    if (!hasSession) {
      return;
    }
    const wakeLock = wakeLockMake({
      navigator,
      document,
      warn: (message) => store.statusSet({ code: 'wake-lock', severity: 'warning', message, blocking: false }),
    });
    wakeLock.start();
    return () => wakeLock.stop();
  }, [store, hasSession]);
}
