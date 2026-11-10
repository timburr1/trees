import type { StoredDocument } from './model';
import { syncHandle, type RecordStore, type SyncRequest } from './sync-handler';

const principal = (userId: string, userDetails: string, identityProvider = 'github') =>
  Buffer.from(JSON.stringify({ userId, userDetails, identityProvider })).toString('base64');

type Harness = {
  readonly store: RecordStore;
  readonly docs: Map<string, StoredDocument>;
  readonly logs: string[];
  readonly clock: { now: number };
  readonly creates: { count: number };
};

function harnessMake(): Harness {
  const docs = new Map<string, StoredDocument>();
  const creates = { count: 0 };
  const store: RecordStore = {
    create: (doc) => {
      creates.count += 1;
      const key = `${doc.userId}|${doc.id}`;
      if (docs.has(key)) {
        return Promise.resolve('exists');
      }
      docs.set(key, doc);
      return Promise.resolve('created');
    },
    list: (userId, since, limit) =>
      Promise.resolve(
        [...docs.values()]
          .filter((doc) => doc.userId === userId && doc.syncedAt >= since)
          .sort((a, b) => (a.syncedAt < b.syncedAt ? -1 : a.syncedAt > b.syncedAt ? 1 : 0))
          .slice(0, limit),
      ),
  };
  return { store, docs, logs: [], clock: { now: Date.parse('2026-06-01T12:00:00.000Z') }, creates };
}

function request(overrides: Partial<SyncRequest>): SyncRequest {
  return {
    method: 'POST',
    principalHeader: principal('u1', 'Tim'),
    userHeader: 'u1',
    since: null,
    limit: null,
    body: () => Promise.resolve({ records: [] }),
    ...overrides,
  };
}

const sessionRecord = (id: string) => ({ kind: 'session', id, data: { id, startedAt: 1 } });

function run(harness: Harness, req: SyncRequest, allowedUsers: readonly string[] = ['tim']) {
  return syncHandle(req, { store: harness.store, allowedUsers, now: () => harness.clock.now, log: (message) => harness.logs.push(message) });
}

describe('syncHandle: access', () => {
  it('answers 401 without a principal', async () => {
    expect((await run(harnessMake(), request({ principalHeader: null }))).status).toBe(401);
  });

  it('answers 403 when the allow list is empty or does not hold the login', async () => {
    expect((await run(harnessMake(), request({}), [])).status).toBe(403);
    expect((await run(harnessMake(), request({ principalHeader: principal('u2', 'stranger') }))).status).toBe(403);
    expect((await run(harnessMake(), request({ principalHeader: principal('u1', 'Tim', 'aad') }))).status).toBe(403);
  });

  it('answers 409 when the expected user differs from the principal, or is missing', async () => {
    expect((await run(harnessMake(), request({ userHeader: 'u2' }))).status).toBe(409);
    expect((await run(harnessMake(), request({ userHeader: null }))).status).toBe(409);
  });

  it('answers 405 for other methods', async () => {
    expect((await run(harnessMake(), request({ method: 'DELETE' }))).status).toBe(405);
  });
});

describe('syncHandle: push', () => {
  it('stores new records under the principal and reports each', async () => {
    const harness = harnessMake();
    const response = await run(harness, request({ body: () => Promise.resolve({ records: [sessionRecord('s1'), sessionRecord('s2')] }) }));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      results: [
        { key: 'session:s1', status: 'stored' },
        { key: 'session:s2', status: 'stored' },
      ],
    });
    expect([...harness.docs.values()].every((doc) => doc.userId === 'u1')).toBe(true);
  });

  it('treats a record that already exists as acknowledged and leaves the stored copy alone', async () => {
    const harness = harnessMake();
    await run(harness, request({ body: () => Promise.resolve({ records: [{ kind: 'session', id: 's1', data: { id: 's1', startedAt: 1 } }] }) }));
    const response = await run(
      harness,
      request({ body: () => Promise.resolve({ records: [{ kind: 'session', id: 's1', data: { id: 's1', startedAt: 999 } }] }) }),
    );
    expect(response.body).toEqual({ results: [{ key: 'session:s1', status: 'exists' }] });
    expect(harness.docs.get('u1|session:s1')?.data).toEqual({ id: 's1', startedAt: 1 });
  });

  it('rejects a bad record on its own, without failing the others or touching the store for it', async () => {
    const harness = harnessMake();
    const response = await run(harness, request({ body: () => Promise.resolve({ records: [sessionRecord('s1'), { kind: 'gadget', id: 'g1', data: {} }] }) }));
    expect(response.status).toBe(200);
    const results = (response.body as { results: { key: string; status: string }[] }).results;
    expect(results.find((entry) => entry.key === 'session:s1')?.status).toBe('stored');
    expect(results.find((entry) => entry.status === 'rejected')).toBeDefined();
    expect(harness.creates.count).toBe(1);
  });

  it('gives each record in a batch its own increasing time, so a pull can order them', async () => {
    const harness = harnessMake();
    await run(harness, request({ body: () => Promise.resolve({ records: [sessionRecord('a'), sessionRecord('b'), sessionRecord('c')] }) }));
    const times = [...harness.docs.values()].map((doc) => doc.syncedAt);
    expect(new Set(times).size).toBe(3);
    expect([...times].sort()).toEqual(times);
  });

  it('answers 400 for a body that is not valid JSON, or not a batch', async () => {
    expect((await run(harnessMake(), request({ body: () => Promise.reject(new SyntaxError('Unexpected token')) }))).status).toBe(400);
    expect((await run(harnessMake(), request({ body: () => Promise.resolve({ nope: 1 }) }))).status).toBe(400);
  });

  it('never lets the body choose the user', async () => {
    const harness = harnessMake();
    const record = { kind: 'session', id: 's1', data: { id: 's1', userId: 'someone-else' }, userId: 'someone-else' };
    await run(harness, request({ body: () => Promise.resolve({ records: [record], userId: 'someone-else' }) }));
    expect([...harness.docs.keys()]).toEqual(['u1|session:s1']);
  });
});

describe('syncHandle: pull', () => {
  async function seeded(): Promise<Harness> {
    const harness = harnessMake();
    await run(harness, request({ body: () => Promise.resolve({ records: ['a', 'b', 'c'].map(sessionRecord) }) }));
    return harness;
  }

  it('returns records with their times, without internal fields', async () => {
    const harness = await seeded();
    const response = await run(harness, request({ method: 'GET' }));
    const body = response.body as { records: { kind: string; id: string; data: unknown; syncedAt: string }[]; more: boolean };
    expect(body.records.map((record) => record.id)).toEqual(['a', 'b', 'c']);
    expect(Object.keys(body.records[0] ?? {}).sort()).toEqual(['data', 'id', 'kind', 'syncedAt']);
    expect(body.more).toBe(false);
  });

  it('pages with more, and an inclusive since returns the boundary record again', async () => {
    const harness = await seeded();
    const first = (await run(harness, request({ method: 'GET', limit: '2' }))).body as { records: { id: string; syncedAt: string }[]; more: boolean };
    expect(first.records.map((record) => record.id)).toEqual(['a', 'b']);
    expect(first.more).toBe(true);
    const since = first.records[1]?.syncedAt ?? '';
    const second = (await run(harness, request({ method: 'GET', since, limit: '2' }))).body as { records: { id: string }[]; more: boolean };
    expect(second.records.map((record) => record.id)).toEqual(['b', 'c']);
    expect(second.more).toBe(false);
  });

  it('only returns the caller own records', async () => {
    const harness = await seeded();
    const other = await run(harness, request({ method: 'GET', principalHeader: principal('u2', 'tim'), userHeader: 'u2' }));
    expect((other.body as { records: unknown[] }).records).toEqual([]);
  });

  it('answers 400 for a bad since or limit', async () => {
    expect((await run(harnessMake(), request({ method: 'GET', since: 'yesterday' }))).status).toBe(400);
    expect((await run(harnessMake(), request({ method: 'GET', limit: 'many' }))).status).toBe(400);
  });
});
