import { allowedUsersParse, batchMax, documentMake, principalRead, pullQueryParse, recordsParse, userAllowed } from './model';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');

describe('principalRead', () => {
  it('reads the user id and login from the header', () => {
    expect(principalRead(encode({ userId: 'u1', userDetails: 'Tim', identityProvider: 'github' }))).toEqual({
      userId: 'u1',
      userDetails: 'Tim',
      identityProvider: 'github',
    });
  });

  it('refuses a missing header, bad base64 or JSON, and a missing or empty user id', () => {
    expect(principalRead(null)).toBeUndefined();
    expect(principalRead('')).toBeUndefined();
    expect(principalRead('%%%')).toBeUndefined();
    expect(principalRead(Buffer.from('not json').toString('base64'))).toBeUndefined();
    expect(principalRead(encode({ userDetails: 'Tim' }))).toBeUndefined();
    expect(principalRead(encode({ userId: '', userDetails: 'Tim' }))).toBeUndefined();
    expect(principalRead(encode(['u1']))).toBeUndefined();
  });

  it('gives an empty login when the header has none', () => {
    expect(principalRead(encode({ userId: 'u1' }))).toEqual({ userId: 'u1', userDetails: '', identityProvider: '' });
  });
});

describe('allow list', () => {
  it('refuses everyone when unset or empty', () => {
    expect(allowedUsersParse(undefined)).toEqual([]);
    expect(allowedUsersParse('  , ')).toEqual([]);
    expect(userAllowed({ userId: 'u1', userDetails: 'Tim', identityProvider: 'github' }, [])).toBe(false);
  });

  it('matches logins case-insensitively and ignores spaces', () => {
    const allowed = allowedUsersParse(' Tim , other ');
    expect(userAllowed({ userId: 'u1', userDetails: 'tim', identityProvider: 'github' }, allowed)).toBe(true);
    expect(userAllowed({ userId: 'u2', userDetails: 'stranger', identityProvider: 'github' }, allowed)).toBe(false);
    expect(userAllowed({ userId: 'u3', userDetails: 'tim', identityProvider: 'aad' }, allowed)).toBe(false);
    expect(userAllowed({ userId: 'u3', userDetails: 'tim', identityProvider: '' }, allowed)).toBe(false);
  });

  it('does not let an empty login match anything', () => {
    expect(userAllowed({ userId: 'u1', userDetails: '', identityProvider: 'github' }, allowedUsersParse('tim'))).toBe(false);
  });
});

describe('recordsParse', () => {
  const session = { kind: 'session', id: 's1', data: { id: 's1', startedAt: 1 } };

  it('accepts records of each kind', () => {
    const parsed = recordsParse({
      records: [
        session,
        { kind: 'purchase', id: 'p1', data: { id: 'p1' } },
        { kind: 'tag', id: 't1', data: { id: 't1' } },
        { kind: 'tag-archive', id: 't1', data: { tagId: 't1', archivedAt: 5 } },
      ],
    });
    expect('error' in parsed).toBe(false);
    expect('valid' in parsed ? parsed.valid : []).toHaveLength(4);
  });

  it('rejects a body that is not an object with a records list, and too many records', () => {
    for (const body of [null, 5, 'x', [], {}, { records: 'x' }]) {
      expect(recordsParse(body)).toHaveProperty('error');
    }
    expect(recordsParse({ records: Array.from({ length: batchMax + 1 }, () => session) })).toHaveProperty('error');
  });

  it('rejects one bad record without failing the others', () => {
    const parsed = recordsParse({ records: [session, { kind: 'gadget', id: 'g', data: {} }, { kind: 'session', id: 'bad id!', data: { id: 'bad id!' } }] });
    if (!('valid' in parsed)) {
      throw new Error('expected a parsed batch');
    }
    expect(parsed.valid.map((record) => record.id)).toEqual(['s1']);
    expect(parsed.rejected).toHaveLength(2);
    expect(parsed.rejected.every((entry) => entry.reason !== '')).toBe(true);
  });

  it('rejects ids outside the allowed characters or length', () => {
    const bad = ['', 'a/b', 'a?b', 'a#b', 'a\\b', 'a:b', 'a'.repeat(101)];
    const parsed = recordsParse({ records: bad.map((id) => ({ kind: 'session', id, data: { id } })) });
    expect('rejected' in parsed ? parsed.rejected.length : 0).toBe(bad.length);
  });

  it('requires the envelope id to equal the data id, or the tag id for an archive', () => {
    const parsed = recordsParse({
      records: [
        { kind: 'session', id: 's1', data: { id: 's2' } },
        { kind: 'tag-archive', id: 't1', data: { tagId: 't2', archivedAt: 1 } },
        { kind: 'tag-archive', id: 't1', data: { tagId: 't1', archivedAt: 1 } },
      ],
    });
    expect('valid' in parsed ? parsed.valid.length : -1).toBe(1);
    expect('rejected' in parsed ? parsed.rejected.length : -1).toBe(2);
  });

  it('rejects data that is not an object or is over the size limit', () => {
    const parsed = recordsParse({
      records: [
        { kind: 'session', id: 's1', data: 'text' },
        { kind: 'session', id: 's2', data: null },
        { kind: 'session', id: 's3', data: { id: 's3', pad: 'x'.repeat(5000) } },
      ],
    });
    expect('rejected' in parsed ? parsed.rejected.length : -1).toBe(3);
  });
});

describe('pullQueryParse', () => {
  it('defaults to everything, at the largest page', () => {
    expect(pullQueryParse(null, null)).toEqual({ since: '1970-01-01T00:00:00.000Z', limit: 500 });
  });

  it('accepts an ISO time and clamps the limit', () => {
    expect(pullQueryParse('2026-06-01T00:00:00.000Z', '50')).toEqual({ since: '2026-06-01T00:00:00.000Z', limit: 50 });
    expect(pullQueryParse(null, '99999')).toMatchObject({ limit: 500 });
    expect(pullQueryParse(null, '0')).toMatchObject({ limit: 1 });
  });

  it('refuses a since that is not a normalized ISO time, and a limit that is not a number', () => {
    expect(pullQueryParse('yesterday', null)).toHaveProperty('error');
    expect(pullQueryParse('2026-06-01', null)).toHaveProperty('error');
    expect(pullQueryParse("' OR 1=1 --", null)).toHaveProperty('error');
    expect(pullQueryParse(null, 'many')).toHaveProperty('error');
  });
});

describe('documentMake', () => {
  it('builds the stored document from the principal, never from the record', () => {
    const doc = documentMake({ kind: 'session', id: 's1', data: { id: 's1', userId: 'attacker', syncedAt: 'x' } }, 'u1', '2026-06-01T00:00:00.000Z');
    expect(doc).toEqual({
      id: 'session:s1',
      userId: 'u1',
      kind: 'session',
      recordId: 's1',
      data: { id: 's1', userId: 'attacker', syncedAt: 'x' },
      syncedAt: '2026-06-01T00:00:00.000Z',
    });
  });
});
