import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { storeOwnerKey } from './lib/store-app.ts';
import { appControllerMake } from './platform/app-controller.ts';
import { chimeUnlock } from './platform/chime.ts';
import './index.css';

const root = document.getElementById('root');
if (!root || !document.getElementById('fatal')) {
  throw new Error('index.html is missing the #root or #fatal element');
}

// The page-level error region, outside the React tree, so it still shows after a render error unmounts everything.
function fatalShow(text: string): void {
  const fatal = document.getElementById('fatal');
  if (fatal) {
    fatal.textContent = text;
  }
}

const log = (message: string) => console.warn(`[trees] ${message}`);

// Created once per page and outside React: a Web Lock cannot be released synchronously, so StrictMode's double mount would otherwise lose it.
const controller = appControllerMake({
  storageGet: () => window.localStorage,
  locks: navigator.locks,
  // Only has to differ between tabs, so it needs no secure context.
  tabIdNew: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  now: () => Date.now(),
  seen: () => document.visibilityState === 'visible',
  log,
});

function errorShow(source: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[trees] ${source}`, error);
  const status = controller.getStatus();
  if (status.kind === 'ready') {
    status.store.statusSet({ code: 'unexpected-error', severity: 'error', message: `Something went wrong: ${message}`, blocking: false });
  } else {
    fatalShow(`Something went wrong: ${message}`);
  }
}

// A render error unmounts the whole tree, so a store banner would never be seen: this goes to the page-level region instead.
function errorFatal(error: unknown): void {
  console.error('[trees] render error', error);
  fatalShow(`Something went wrong: ${error instanceof Error ? error.message : String(error)}. Reload the page; your saved data is untouched.`);
}

window.addEventListener('error', (event) => errorShow('window error', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => errorShow('unhandled rejection', event.reason));
// A page restored from the back/forward cache never reloads, so the lock and store are given up on the way in and rebuilt on the way out.
window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    controller.suspend();
  }
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    void controller.start();
  }
});
// Another tab took the owner token: stop writing now, not at the next write.
window.addEventListener('storage', (event) => {
  const status = controller.getStatus();
  if (event.key === storeOwnerKey && status.kind === 'ready') {
    status.store.ownerCheck();
  }
});
// A reload mid-session has no Start click to unlock audio, so the first activating gesture does it. `pointerdown` does not count as activation for touch, so listen for `click` and `pointerup`.
const unlock = () => chimeUnlock((message) => log(message));
for (const type of ['click', 'pointerup', 'keydown'] as const) {
  document.addEventListener(type, unlock);
}

createRoot(root, {
  onUncaughtError: errorFatal,
  onRecoverableError: (error) => console.warn('[trees] recoverable render error', error),
}).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
);

void controller.start();
// Best effort: ask the browser not to evict our storage under pressure. A refusal is only logged.
async function storagePersist(): Promise<void> {
  if (typeof navigator.storage?.persist !== 'function') {
    return;
  }
  try {
    log(`persistent storage ${(await navigator.storage.persist()) ? 'granted' : 'not granted'}`);
  } catch (error) {
    log(`persistent storage request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
void storagePersist();
