export type WakeLockSentinelLike = {
  readonly release: () => Promise<void>;
  readonly addEventListener: (type: 'release', listener: () => void) => void;
};

export type WakeLockNavigatorLike = {
  readonly wakeLock?: { readonly request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

export type WakeLockDocumentLike = {
  visibilityState: 'visible' | 'hidden';
  readonly addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  readonly removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
};

export type WakeLockOptions = {
  readonly navigator: WakeLockNavigatorLike;
  readonly document: WakeLockDocumentLike;
  readonly warn: (message: string) => void;
};

export type WakeLock = {
  /** Keeps the screen awake until `stop`, asking again whenever the page becomes visible. */
  readonly start: () => void;
  readonly stop: () => void;
};

/** The browser drops the lock whenever the page is hidden, so this re-requests on becoming visible and warns only about releases that happen while the page is visible. */
export function wakeLockMake({ navigator, document, warn }: WakeLockOptions): WakeLock {
  let wanted = false;
  let requesting = false;
  let sentinel: WakeLockSentinelLike | undefined;
  let unsupportedWarned = false;

  async function acquire(): Promise<void> {
    const api = navigator.wakeLock;
    if (!api) {
      if (!unsupportedWarned) {
        unsupportedWarned = true;
        warn('This browser cannot keep the screen awake. Your screen may turn off during a session.');
      }
      return;
    }
    if (!wanted || requesting || sentinel || document.visibilityState !== 'visible') {
      return;
    }
    requesting = true;
    try {
      const granted = await api.request('screen');
      if (!wanted) {
        await granted.release();
        return;
      }
      sentinel = granted;
      granted.addEventListener('release', () => {
        if (sentinel === granted) {
          sentinel = undefined;
        }
        if (wanted && document.visibilityState === 'visible') {
          warn('The system released the screen wake lock. Your screen may turn off during a session.');
        }
      });
    } catch (error) {
      if (document.visibilityState === 'visible') {
        warn(`Could not keep the screen awake: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      requesting = false;
    }
  }

  function visibilityChanged(): void {
    void acquire();
  }

  return {
    start: () => {
      if (wanted) {
        return;
      }
      wanted = true;
      document.addEventListener('visibilitychange', visibilityChanged);
      void acquire();
    },
    stop: () => {
      if (!wanted) {
        return;
      }
      wanted = false;
      document.removeEventListener('visibilitychange', visibilityChanged);
      const held = sentinel;
      sentinel = undefined;
      if (held) {
        void held.release();
      }
    },
  };
}
