import { ErrorSyncAccount, ErrorSyncAuth, ErrorSyncDenied, ErrorSyncNetwork, ErrorSyncResponse, ErrorSyncServer } from '../lib/errors.ts';
import type { SyncRecord } from '../lib/sync-wire.ts';

export type SyncAuth = { readonly userId: string; readonly login: string };

export type SyncPushResult = { readonly key: string; readonly status: 'stored' | 'exists' | 'rejected'; readonly reason: string | undefined };

/** `records` are raw: the caller validates each one with `syncPulledCoerce`, because the network is a boundary. */
export type SyncPullPage = { readonly records: readonly unknown[]; readonly more: boolean; readonly lastSyncedAt: string | undefined };

export type SyncApi = {
  /** Undefined when nobody is signed in. A network or server failure throws. */
  readonly authMe: () => Promise<SyncAuth | undefined>;
  readonly push: (records: readonly SyncRecord[], userId: string) => Promise<readonly SyncPushResult[]>;
  readonly pull: (since: string | undefined, userId: string) => Promise<SyncPullPage>;
};

/** `fetch` rejects with a TypeError when the request cannot be made. Naming that case keeps a TypeError from a bug elsewhere from reading as "offline". */
async function fetchTry(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ErrorSyncNetwork('Could not reach the sync server.', { cause: error });
    }
    throw error;
  }
}

function fieldRead(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

async function bodyRead(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new ErrorSyncResponse('The sync server sent a body that is not JSON.', { cause: error });
  }
}

async function okBody(response: Response): Promise<unknown> {
  switch (response.status) {
    case 401:
      throw new ErrorSyncAuth('Sign in to sync.');
    case 403:
      throw new ErrorSyncDenied('This account is not allowed to sync.');
    case 409:
      throw new ErrorSyncAccount('The signed-in account changed.');
    default:
      if (!response.ok) {
        throw new ErrorSyncServer(`The sync server answered ${response.status}.`);
      }
      return bodyRead(response);
  }
}

function resultRead(entry: unknown): SyncPushResult {
  const key = fieldRead(entry, 'key');
  const status = fieldRead(entry, 'status');
  const reason = fieldRead(entry, 'reason');
  if (typeof key !== 'string' || (status !== 'stored' && status !== 'exists' && status !== 'rejected')) {
    throw new ErrorSyncResponse('The sync server sent a push result that is not valid.');
  }
  return { key, status, reason: typeof reason === 'string' ? reason : undefined };
}

/** The `x-trees-user` header makes the server refuse a request when the signed-in account is not the one this page believes it is. */
export function syncApiMake(fetchFn: typeof fetch): SyncApi {
  return {
    authMe: async () => {
      const response = await fetchTry(fetchFn, '/.auth/me', { cache: 'no-store' });
      if (response.status >= 500) {
        throw new ErrorSyncServer(`The sign-in service answered ${response.status}.`);
      }
      // A missing endpoint (the dev server has none) reads as signed out.
      if (!response.ok) {
        return undefined;
      }
      const principal = fieldRead(await bodyRead(response), 'clientPrincipal');
      const userId = fieldRead(principal, 'userId');
      const login = fieldRead(principal, 'userDetails');
      return typeof userId === 'string' && userId !== '' ? { userId, login: typeof login === 'string' ? login : '' } : undefined;
    },
    push: async (records, userId) => {
      const response = await fetchTry(fetchFn, '/api/sync', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-trees-user': userId },
        body: JSON.stringify({ records: records.map((record) => ({ kind: record.kind, id: record.id, data: record.data })) }),
      });
      const results = fieldRead(await okBody(response), 'results');
      if (!Array.isArray(results)) {
        throw new ErrorSyncResponse('The sync server sent a push answer without results.');
      }
      return results.map(resultRead);
    },
    pull: async (since, userId) => {
      const query = since === undefined ? '' : `?since=${encodeURIComponent(since)}`;
      const response = await fetchTry(fetchFn, `/api/sync${query}`, { method: 'GET', cache: 'no-store', headers: { 'x-trees-user': userId } });
      const body = await okBody(response);
      const records = fieldRead(body, 'records');
      const more = fieldRead(body, 'more');
      if (!Array.isArray(records) || typeof more !== 'boolean') {
        throw new ErrorSyncResponse('The sync server sent a pull answer that is not valid.');
      }
      const times = records.map((record): unknown => fieldRead(record, 'syncedAt'));
      if (!times.every((time): time is string => typeof time === 'string')) {
        throw new ErrorSyncResponse('The sync server sent a record without a time.');
      }
      return { records, more, lastSyncedAt: times.at(-1) };
    },
  };
}
