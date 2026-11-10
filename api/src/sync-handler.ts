import { documentMake, principalRead, pullQueryParse, recordsParse, userAllowed, type RecordKind, type StoredDocument, type WireRecord } from './model';

export type RecordStore = {
  /** Inserts only. A record that exists is left as it is. */
  readonly create: (doc: StoredDocument) => Promise<'created' | 'exists'>;
  /** The user's records from `since` on, inclusive, by time, at most `limit`. */
  readonly list: (userId: string, since: string, limit: number) => Promise<readonly StoredDocument[]>;
};

export type SyncRequest = {
  readonly method: string;
  readonly principalHeader: string | null;
  /** The user the client believes it is signed in as, so an account switch mid-flight cannot write into the wrong partition. */
  readonly userHeader: string | null;
  readonly since: string | null;
  readonly limit: string | null;
  readonly body: () => Promise<unknown>;
};

export type SyncResponse = { readonly status: number; readonly body: unknown };

export type SyncDeps = {
  readonly store: RecordStore;
  readonly allowedUsers: readonly string[];
  readonly now: () => number;
  readonly log: (message: string) => void;
};

type PushResult = { readonly key: string; readonly status: 'stored' | 'exists' | 'rejected'; readonly reason?: string };

const writeConcurrency = 10;

async function recordsStore(records: readonly WireRecord[], userId: string, deps: SyncDeps): Promise<readonly PushResult[]> {
  // One start time per request, plus a millisecond per record, so records of a batch have distinct times and a pull orders them as sent.
  const start = deps.now();
  const results: PushResult[] = [];
  for (let from = 0; from < records.length; from += writeConcurrency) {
    const chunk = records.slice(from, from + writeConcurrency);
    const outcomes = await Promise.all(
      chunk.map((record, offset) => deps.store.create(documentMake(record, userId, new Date(start + from + offset).toISOString()))),
    );
    chunk.forEach((record, offset) => {
      results.push({ key: `${record.kind}:${record.id}`, status: outcomes[offset] === 'created' ? 'stored' : 'exists' });
    });
  }
  return results;
}

async function push(request: SyncRequest, userId: string, deps: SyncDeps): Promise<SyncResponse> {
  let body: unknown;
  try {
    body = await request.body();
  } catch (error) {
    deps.log(`push body unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 400, body: { error: 'The body is not valid JSON.' } };
  }
  const parsed = recordsParse(body);
  if ('error' in parsed) {
    return { status: 400, body: parsed };
  }
  const stored = await recordsStore(parsed.valid, userId, deps);
  const rejected = parsed.rejected.map((entry): PushResult => ({ key: entry.key, status: 'rejected', reason: entry.reason }));
  deps.log(
    `push: stored=${stored.filter((entry) => entry.status === 'stored').length} existed=${stored.filter((entry) => entry.status === 'exists').length} rejected=${rejected.length}`,
  );
  return { status: 200, body: { results: [...stored, ...rejected] } };
}

async function pull(request: SyncRequest, userId: string, deps: SyncDeps): Promise<SyncResponse> {
  const query = pullQueryParse(request.since, request.limit);
  if ('error' in query) {
    return { status: 400, body: query };
  }
  // One extra record tells whether another page exists.
  const found = await deps.store.list(userId, query.since, query.limit + 1);
  const page = found.slice(0, query.limit);
  const records = page.map((doc: StoredDocument): { kind: RecordKind; id: string; data: object; syncedAt: string } => ({
    kind: doc.kind,
    id: doc.recordId,
    data: doc.data,
    syncedAt: doc.syncedAt,
  }));
  deps.log(`pull: since=${query.since} returned=${records.length}`);
  return { status: 200, body: { records, more: found.length > query.limit } };
}

/** The whole sync endpoint apart from the HTTP and Cosmos plumbing, so tests can drive it with a fake store. */
export async function syncHandle(request: SyncRequest, deps: SyncDeps): Promise<SyncResponse> {
  const principal = principalRead(request.principalHeader);
  if (!principal) {
    return { status: 401, body: { error: 'Sign in to sync.' } };
  }
  if (!userAllowed(principal, deps.allowedUsers)) {
    deps.log(`refused user ${principal.userId}: not on the allow list`);
    return { status: 403, body: { error: 'Sync is not enabled for this account.' } };
  }
  if (request.userHeader !== principal.userId) {
    return { status: 409, body: { error: 'The signed-in account changed. Reload to continue.' } };
  }
  switch (request.method.toUpperCase()) {
    case 'POST':
      return push(request, principal.userId, deps);
    case 'GET':
      return pull(request, principal.userId, deps);
    default:
      return { status: 405, body: { error: 'Use GET or POST.' } };
  }
}
