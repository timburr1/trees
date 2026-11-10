export const batchMax = 100;
export const pullLimitMax = 500;
const dataBytesMax = 4096;
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const epoch = '1970-01-01T00:00:00.000Z';

export const recordKinds = ['session', 'purchase', 'tag', 'tag-archive'] as const;
export type RecordKind = (typeof recordKinds)[number];

export type Principal = { readonly userId: string; readonly userDetails: string; readonly identityProvider: string };

/** What a client sends. The server checks its shape and size and stores `data` as it came: the client validates the content when it reads it back. */
export type WireRecord = { readonly kind: RecordKind; readonly id: string; readonly data: object };

export type RecordRejected = { readonly key: string; readonly reason: string };

export type RecordsParsed = { readonly valid: readonly WireRecord[]; readonly rejected: readonly RecordRejected[] };

export type ParseError = { readonly error: string };

export type PullQuery = { readonly since: string; readonly limit: number };

export type StoredDocument = {
  readonly id: string;
  readonly userId: string;
  readonly kind: RecordKind;
  readonly recordId: string;
  readonly data: object;
  readonly syncedAt: string;
};

function objectRead(value: unknown): object | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function kindRead(value: unknown): RecordKind | undefined {
  return recordKinds.find((kind) => kind === value);
}

/** Reads SWA's `x-ms-client-principal` header. SWA sets it after authenticating the request; the body never supplies it. */
export function principalRead(header: string | null | undefined): Principal | undefined {
  if (!header) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch (error) {
    // A header SWA did not write is untrusted input, not a bug: treat it as no principal.
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
  const fields = objectRead(parsed);
  const userId: unknown = fields && Reflect.get(fields, 'userId');
  const userDetails: unknown = fields && Reflect.get(fields, 'userDetails');
  const identityProvider: unknown = fields && Reflect.get(fields, 'identityProvider');
  if (typeof userId !== 'string' || userId === '') {
    return undefined;
  }
  return {
    userId,
    userDetails: typeof userDetails === 'string' ? userDetails : '',
    identityProvider: typeof identityProvider === 'string' ? identityProvider : '',
  };
}

/** `ALLOWED_USERS` is a comma-separated list of GitHub logins. */
export function allowedUsersParse(raw: string | undefined): readonly string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

/** The login is only a GitHub login when GitHub issued it: another provider (SWA enables Entra ID by default) can hand out the same text. */
export function userAllowed(principal: Principal, allowed: readonly string[]): boolean {
  return principal.identityProvider === 'github' && allowed.includes(principal.userDetails.toLowerCase());
}

function recordCheck(entry: unknown): { readonly record: WireRecord } | { readonly rejected: RecordRejected } {
  const fields = objectRead(entry);
  const kind = kindRead(fields && Reflect.get(fields, 'kind'));
  const id: unknown = fields && Reflect.get(fields, 'id');
  const key = typeof id === 'string' && kind !== undefined ? `${kind}:${id}` : 'unknown';
  const reject = (reason: string) => ({ rejected: { key, reason } });
  if (!fields || kind === undefined) {
    return reject('unknown kind');
  }
  if (typeof id !== 'string' || !idPattern.test(id)) {
    return reject('id must be 1 to 100 letters, digits, dashes, or underscores');
  }
  const data = objectRead(Reflect.get(fields, 'data'));
  if (!data) {
    return reject('data must be an object');
  }
  const dataId: unknown = Reflect.get(data, kind === 'tag-archive' ? 'tagId' : 'id');
  if (dataId !== id) {
    return reject('id does not match the data');
  }
  if (JSON.stringify(data).length > dataBytesMax) {
    return reject('data is too large');
  }
  return { record: { kind, id, data } };
}

export function recordsParse(body: unknown): RecordsParsed | ParseError {
  const fields = objectRead(body);
  const records: unknown = fields && Reflect.get(fields, 'records');
  if (!Array.isArray(records)) {
    return { error: 'The body needs a records list.' };
  }
  if (records.length > batchMax) {
    return { error: `At most ${batchMax} records per request.` };
  }
  const valid: WireRecord[] = [];
  const rejected: RecordRejected[] = [];
  for (const entry of records) {
    const checked = recordCheck(entry);
    if ('record' in checked) {
      valid.push(checked.record);
    } else {
      rejected.push(checked.rejected);
    }
  }
  return { valid, rejected };
}

/** `since` must be exactly what `toISOString` produces, because the stored times are compared as text. */
export function pullQueryParse(since: string | null, limit: string | null): PullQuery | ParseError {
  if (since !== null && (Number.isNaN(Date.parse(since)) || new Date(since).toISOString() !== since)) {
    return { error: 'since must be an ISO time such as 2026-06-01T00:00:00.000Z.' };
  }
  if (limit !== null && !/^\d+$/.test(limit)) {
    return { error: 'limit must be a whole number.' };
  }
  const wanted = limit === null ? pullLimitMax : Number(limit);
  return { since: since ?? epoch, limit: Math.min(pullLimitMax, Math.max(1, wanted)) };
}

export function documentMake(record: WireRecord, userId: string, syncedAt: string): StoredDocument {
  return { id: `${record.kind}:${record.id}`, userId, kind: record.kind, recordId: record.id, data: record.data, syncedAt };
}
