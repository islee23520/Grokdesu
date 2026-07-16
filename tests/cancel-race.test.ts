import {expect, test} from 'bun:test';
import {createGateway} from '../apps/gateway/src/app';
import type {LiveProvider, ProviderCapability} from '../apps/gateway/src/providers';
type ProviderId = 'senpi' | 'grok';
type Session = {id: string; provider: ProviderId; projectId: string; title: string; generation: number; updatedAt: string; status: string};
type TranscriptEvent = {id: number; type: string; generation: number; at: string; role?: string; text?: string};

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
};

function provider(id: ProviderId, capability: ProviderCapability, behavior: Partial<LiveProvider> = {}): LiveProvider {
  const session = {id: `${id}-race`, provider: id, projectId: 'fixture', title: 'race', generation: 0, updatedAt: new Date().toISOString(), status: 'idle'} as any;
  return {
    id,
    capability: async () => capability,
    list: async () => [session],
    create: async () => session,
    load: async () => session,
    transcript: async () => [] as any,
    send: async () => {},
    cancel: async () => {},
    ...behavior,
  };
}

async function paired(app: ReturnType<typeof createGateway>) {
  const requested = await app.fetch(new Request('http://localhost/api/v1/pairing/request', {method: 'POST'}));
  const {code} = await requested.json() as any;
  const exchanged = await app.fetch(new Request('http://localhost/api/v1/pairing/exchange', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code, scopes: ['metadata:read', 'session:create', 'session:send', 'session:cancel']})}));
  return (await exchanged.json() as any).token as string;
}

const message = (app: ReturnType<typeof createGateway>, token: string, id: string, generation: number) => app.fetch(new Request(`http://localhost/api/v1/sessions/${id}/messages`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', 'if-match': `"generation-${generation}"`}, body: JSON.stringify({text: 'race'})}));
const cancel = (app: ReturnType<typeof createGateway>, token: string, id: string, generation: number) => app.fetch(new Request(`http://localhost/api/v1/sessions/${id}/cancel`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', 'if-match': `"generation-${generation}"`}, body: JSON.stringify({confirm: true})}));
const session = async (app: ReturnType<typeof createGateway>, token: string, id: string) => (await (await app.fetch(new Request(`http://localhost/api/v1/sessions/${id}`, {headers: {authorization: `Bearer ${token}`}}))).json() as any).session as Session;

async function created(app: ReturnType<typeof createGateway>, token: string, provider: ProviderId) {
  const response = await app.fetch(new Request('http://localhost/api/v1/sessions', {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({provider})}));
  return (await response.json() as any).session as Session;
}

test('unsupported cancel preserves generation and status without calling the provider', async () => {
  let cancelled = 0;
  const app = createGateway({secret: 'test', providers: new Map([['grok', provider('grok', {id: 'grok', available: true, transport: 'fake', detail: 'fake', capabilities: ['create']}, {cancel: async () => { cancelled++; }})]])});
  const token = await paired(app);
  const createdSession = await created(app, token, 'grok');
  const before = await session(app, token, createdSession.id);
  const response = await cancel(app, token, createdSession.id, before.generation);
  expect(response.status).toBe(501);
  expect(await session(app, token, createdSession.id)).toEqual(before);
  expect(cancelled).toBe(0);
});

test('client-known generation cancels the active Senpi turn exactly once', async () => {
  const started = deferred();
  const interrupted = deferred();
  let active = false;
  let cancelled = 0;
  const app = createGateway({secret: 'test', providers: new Map([['senpi', provider('senpi', {id: 'senpi', available: true, transport: 'fake', detail: 'fake', capabilities: ['create', 'send', 'cancel']}, {
    send: async () => { active = true; started.resolve(); await interrupted.promise; active = false; },
    cancel: async () => { expect(active).toBe(true); cancelled++; interrupted.resolve(); },
  })]])});
  const token = await paired(app);
  const createdSession = await created(app, token, 'senpi');
  const sending = message(app, token, createdSession.id, createdSession.generation);
  await started.promise;
  expect((await session(app, token, createdSession.id)).status).toBe('streaming');
  const first = await cancel(app, token, createdSession.id, createdSession.generation);
  const second = await cancel(app, token, createdSession.id, createdSession.generation);
  expect(first.status).toBe(200);
  expect(second.status).toBe(409);
  expect(cancelled).toBe(1);
  expect((await sending).status).toBe(200);
  const final = await session(app, token, createdSession.id);
  expect(final).toMatchObject({generation: createdSession.generation + 1, status: 'cancelled'});
});

test('a prior generation is stale after a completed send', async () => {
  const app = createGateway({secret: 'test', providers: new Map([['senpi', provider('senpi', {id: 'senpi', available: true, transport: 'fake', detail: 'fake', capabilities: ['create', 'send', 'cancel']})]])});
  const token = await paired(app);
  const createdSession = await created(app, token, 'senpi');
  expect((await message(app, token, createdSession.id, createdSession.generation)).status).toBe(200);
  expect((await cancel(app, token, createdSession.id, createdSession.generation)).status).toBe(409);
});
