import { ErrorSyncAccount, ErrorSyncAuth, ErrorSyncDenied, ErrorSyncNetwork, ErrorSyncResponse, ErrorSyncServer } from '../lib/errors.ts';
import { sessionFinishedMake } from '../test/fixtures.ts';
import { syncApiMake } from './sync-api.ts';

type Call = { readonly url: string; readonly init: RequestInit | undefined };

function fetchFake(respond: (call: Call) => Response | Promise<Response>): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const call = { url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetchFn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const headerOf = (call: Call | undefined, name: string) => new Headers(call?.init?.headers).get(name);

describe('syncApiMake: authMe', () => {
  it('returns the signed-in user', async () => {
    const { fetchFn, calls } = fetchFake(() => json({ clientPrincipal: { userId: 'u1', userDetails: 'tim', identityProvider: 'github' } }));
    expect(await syncApiMake(fetchFn).authMe()).toEqual({ userId: 'u1', login: 'tim' });
    expect(calls[0]?.url).toBe('/.auth/me');
  });

  it('returns undefined when nobody is signed in, or the answer has no usable user', async () => {
    for (const body of [{ clientPrincipal: null }, {}, { clientPrincipal: { userDetails: 'tim' } }, { clientPrincipal: { userId: '' } }, null]) {
      expect(await syncApiMake(fetchFake(() => json(body)).fetchFn).authMe()).toBeUndefined();
    }
  });

  it('returns undefined when the endpoint is missing, and reports a server failure and a network failure', async () => {
    expect(await syncApiMake(fetchFake(() => json({}, 404)).fetchFn).authMe()).toBeUndefined();
    await expect(syncApiMake(fetchFake(() => json({}, 500)).fetchFn).authMe()).rejects.toBeInstanceOf(ErrorSyncServer);
    const failing: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(syncApiMake(failing).authMe()).rejects.toBeInstanceOf(ErrorSyncNetwork);
    await expect(syncApiMake(failing).push([], 'u1')).rejects.toBeInstanceOf(ErrorSyncNetwork);
    await expect(syncApiMake(failing).pull(undefined, 'u1')).rejects.toBeInstanceOf(ErrorSyncNetwork);
  });
});

describe('syncApiMake: push', () => {
  const records = [{ kind: 'session' as const, id: 's1', data: sessionFinishedMake({ id: 's1' }) }];

  it('posts the records with the expected user, never caching', async () => {
    const { fetchFn, calls } = fetchFake(() => json({ results: [{ key: 'session:s1', status: 'stored' }] }));
    const results = await syncApiMake(fetchFn).push(records, 'u1');
    expect(results).toEqual([{ key: 'session:s1', status: 'stored', reason: undefined }]);
    expect(calls[0]?.url).toBe('/api/sync');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.cache).toBe('no-store');
    expect(headerOf(calls[0], 'x-trees-user')).toBe('u1');
    const body = calls[0]?.init?.body;
    const sent: unknown = JSON.parse(typeof body === 'string' ? body : 'null');
    const data: unknown = JSON.parse(JSON.stringify(records[0]?.data));
    expect(sent).toEqual({ records: [{ kind: 'session', id: 's1', data }] });
  });

  it('keeps the reason of a rejected record', async () => {
    const { fetchFn } = fetchFake(() => json({ results: [{ key: 'session:s1', status: 'rejected', reason: 'too large' }] }));
    expect(await syncApiMake(fetchFn).push(records, 'u1')).toEqual([{ key: 'session:s1', status: 'rejected', reason: 'too large' }]);
  });

  it.each([
    [401, ErrorSyncAuth],
    [403, ErrorSyncDenied],
    [409, ErrorSyncAccount],
    [500, ErrorSyncServer],
    [400, ErrorSyncServer],
  ])('maps status %i to its error', async (status, errorClass) => {
    const { fetchFn } = fetchFake(() => json({ error: 'no' }, status));
    await expect(syncApiMake(fetchFn).push(records, 'u1')).rejects.toBeInstanceOf(errorClass);
  });

  it('rejects an answer that is not the expected shape', async () => {
    for (const body of [{}, { results: 'x' }, { results: [{ key: 5, status: 'stored' }] }, { results: [{ key: 'a', status: 'maybe' }] }, null]) {
      await expect(syncApiMake(fetchFake(() => json(body)).fetchFn).push(records, 'u1')).rejects.toBeInstanceOf(ErrorSyncResponse);
    }
  });
});

describe('syncApiMake: pull', () => {
  it('asks for records since a time and returns the raw records, the paging flag, and the last time', async () => {
    const raw = [
      { kind: 'session', id: 'a', data: {}, syncedAt: '2026-06-01T00:00:00.000Z' },
      { kind: 'session', id: 'b', data: {}, syncedAt: '2026-06-01T00:00:01.000Z' },
    ];
    const { fetchFn, calls } = fetchFake(() => json({ records: raw, more: true }));
    const page = await syncApiMake(fetchFn).pull('2026-05-31T00:00:00.000Z', 'u1');
    expect(page).toEqual({ records: raw, more: true, lastSyncedAt: '2026-06-01T00:00:01.000Z' });
    expect(calls[0]?.url).toBe('/api/sync?since=2026-05-31T00%3A00%3A00.000Z');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(headerOf(calls[0], 'x-trees-user')).toBe('u1');
  });

  it('omits since for the first pull', async () => {
    const { fetchFn, calls } = fetchFake(() => json({ records: [], more: false }));
    expect(await syncApiMake(fetchFn).pull(undefined, 'u1')).toEqual({ records: [], more: false, lastSyncedAt: undefined });
    expect(calls[0]?.url).toBe('/api/sync');
  });

  it('rejects an answer that is not the expected shape, or that pages without times', async () => {
    for (const body of [{}, { records: {}, more: false }, { records: [], more: 'yes' }, { records: [{ kind: 'session' }], more: true }]) {
      await expect(syncApiMake(fetchFake(() => json(body)).fetchFn).pull(undefined, 'u1')).rejects.toBeInstanceOf(ErrorSyncResponse);
    }
  });

  it('maps the same statuses as push', async () => {
    await expect(syncApiMake(fetchFake(() => json({}, 401)).fetchFn).pull(undefined, 'u1')).rejects.toBeInstanceOf(ErrorSyncAuth);
  });
});
