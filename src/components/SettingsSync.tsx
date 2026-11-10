import { useState } from 'react';
import { useSyncStatus } from '../hooks/useSyncStatus.ts';
import type { SyncController } from '../platform/sync-controller.ts';

/** Sign-in turns sync on; signed out, the forest stays on this device. The sign-in and sign-out links are Azure's built-in endpoints. */
export function SettingsSync({ sync }: { sync: SyncController }) {
  const status = useSyncStatus(sync);
  const [unlinking, setUnlinking] = useState(false);
  const signedIn = status.kind === 'idle' || status.kind === 'syncing' || status.kind === 'offline' || status.kind === 'error';

  function onUnlinkConfirm(): void {
    sync.unlink();
    setUnlinking(false);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Sync</h2>
      {status.kind === 'signed-out' ? (
        <>
          <p className="text-sm">Sign in to keep one forest across your devices. Signed out, everything stays on this device.</p>
          <a className="inline-block rounded bg-accent px-4 py-2 text-accent-ink" href="/.auth/login/github?post_login_redirect_uri=/">
            Sign in with GitHub
          </a>
        </>
      ) : null}
      {signedIn ? (
        <>
          <p className="text-sm">Signed in as {status.login ?? 'an unknown account'}.</p>
          <p className="text-sm text-muted">
            {status.lastSyncedAt === undefined ? 'Not synced yet.' : `Last synced: ${new Date(status.lastSyncedAt).toLocaleString()}.`}{' '}
            {status.pending > 0 ? `${status.pending} records waiting to upload.` : ''}
          </p>
          {status.kind === 'offline' ? <p className="text-sm">Offline. Sync resumes when the connection returns.</p> : null}
          {status.kind === 'error' ? (
            <p role="alert" className="text-sm">
              {status.message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={status.kind === 'syncing'}
              className="rounded bg-accent px-4 py-2 text-accent-ink disabled:opacity-50"
              onClick={() => void sync.syncNow()}
            >
              {status.kind === 'syncing' ? 'Syncing' : 'Sync now'}
            </button>
            <a className="rounded border border-line px-4 py-2" href="/.auth/logout?post_logout_redirect_uri=/">
              Sign out
            </a>
            {unlinking ? null : (
              <button type="button" className="rounded border border-line px-4 py-2" onClick={() => setUnlinking(true)}>
                Unlink this device
              </button>
            )}
          </div>
          {unlinking ? (
            <div className="space-y-2 text-sm">
              <p>
                Unlinking forgets which account this device syncs with. The next sync uploads everything here again and merges it with the cloud copy. Nothing
                is deleted.
              </p>
              <div className="flex gap-2">
                <button type="button" autoFocus className="rounded border border-red-500 px-3 py-1" onClick={onUnlinkConfirm}>
                  Unlink
                </button>
                <button type="button" className="rounded border border-line px-3 py-1" onClick={() => setUnlinking(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
