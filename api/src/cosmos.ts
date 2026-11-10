import { CosmosClient, ErrorResponse, IndexingMode, type Container } from '@azure/cosmos';
import type { StoredDocument } from './model';
import type { RecordStore } from './sync-handler';

let containerPromise: Promise<Container> | undefined;

function envRequire(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

// The database holds the shared 400 RU/s, so the container has no throughput of its own: a dedicated container throughput would make a free account billable.
// Only `syncedAt` is indexed because that is the only field queried by value; everything else is read by partition and id.
// These settings apply when the container is created; an existing container keeps the policy it was created with.
async function containerOpen(): Promise<Container> {
  const client = new CosmosClient(envRequire('COSMOS_CONNECTION_STRING'));
  const { database } = await client.databases.createIfNotExists({ id: process.env.COSMOS_DATABASE ?? 'trees', throughput: 400 });
  const { container } = await database.containers.createIfNotExists({
    id: process.env.COSMOS_CONTAINER ?? 'records',
    partitionKey: { paths: ['/userId'] },
    indexingPolicy: { indexingMode: IndexingMode.consistent, includedPaths: [{ path: '/syncedAt/?' }], excludedPaths: [{ path: '/*' }] },
  });
  return container;
}

/** One client per process. A failed open is not cached, so a transient error does not stick. */
function containerGet(): Promise<Container> {
  containerPromise ??= containerOpen().catch((error: unknown) => {
    containerPromise = undefined;
    throw error;
  });
  return containerPromise;
}

function documentRead(item: StoredDocument): StoredDocument {
  return { id: item.id, userId: item.userId, kind: item.kind, recordId: item.recordId, data: item.data, syncedAt: item.syncedAt };
}

export const recordStore: RecordStore = {
  create: async (doc) => {
    const container = await containerGet();
    try {
      await container.items.create(doc);
      return 'created';
    } catch (error) {
      if (error instanceof ErrorResponse && error.code === 409) {
        return 'exists';
      }
      throw error;
    }
  },
  list: async (userId, since, limit) => {
    const container = await containerGet();
    // The partition key scopes the query to this user.
    const { resources } = await container.items
      .query<StoredDocument>(
        {
          query: 'SELECT * FROM c WHERE c.syncedAt >= @since ORDER BY c.syncedAt OFFSET 0 LIMIT @limit',
          parameters: [
            { name: '@since', value: since },
            { name: '@limit', value: limit },
          ],
        },
        { partitionKey: userId },
      )
      .fetchAll();
    return resources.map(documentRead);
  },
};
