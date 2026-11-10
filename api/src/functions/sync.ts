import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { recordStore } from '../cosmos';
import { allowedUsersParse } from '../model';
import { syncHandle } from '../sync-handler';

async function handler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const response = await syncHandle(
      {
        method: request.method,
        principalHeader: request.headers.get('x-ms-client-principal'),
        userHeader: request.headers.get('x-trees-user'),
        since: request.query.get('since'),
        limit: request.query.get('limit'),
        body: () => request.json(),
      },
      { store: recordStore, allowedUsers: allowedUsersParse(process.env.ALLOWED_USERS), now: () => Date.now(), log: (message) => context.log(message) },
    );
    return { status: response.status, jsonBody: response.body, headers: { 'cache-control': 'no-store' } };
  } catch (error) {
    context.error(`sync failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 500, jsonBody: { error: 'Sync failed. Your changes are still saved on this device.' }, headers: { 'cache-control': 'no-store' } };
  }
}

// SWA enforces the `authenticated` role on /api/* before the request arrives; the handler checks the principal and the allow list again.
app.http('sync', { methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'sync', handler });
