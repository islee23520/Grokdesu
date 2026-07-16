import {expect, test} from 'bun:test';
import {createGateway} from '../apps/gateway/src/app';
import type {LiveProvider, ProviderCapability} from '../apps/gateway/src/providers';
import type {ProviderId, Session, TranscriptEvent} from '../packages/protocol/src';

const stamp = () => '2026-07-16T00:00:00.000Z';
class StatefulProvider implements LiveProvider {
  readonly calls: string[] = [];
  readonly events: TranscriptEvent[] = [];
  constructor(readonly id: ProviderId, private readonly supported = ['list', 'create', 'load', 'send', 'cancel', 'transcript']) {}
  async capability(): Promise<ProviderCapability> { return {id: this.id, available: true, transport: 'test', detail: 'live test provider', capabilities: this.supported}; }
  async list() { this.calls.push('list'); return []; }
  async create(_cwd: string, title?: string): Promise<Session> { this.calls.push('create'); return {id: `${this.id}-created`, provider: this.id, projectId: 'test', title: title ?? 'created', generation: 0, updatedAt: stamp(), status: 'idle'}; }
  async load(id: string): Promise<Session> { this.calls.push(`load:${id}`); return {id, provider: this.id, projectId: 'test', title: 'loaded', generation: 0, updatedAt: stamp(), status: 'idle'}; }
  async transcript(id: string) { this.calls.push(`transcript:${id}`); return [...this.events]; }
  async send(id: string, text: string) { this.calls.push(`send:${id}:${text}`); this.events.push({id: this.events.length + 1, type: 'message', role: 'assistant', text: `provider-result:${this.id}:${text}`, generation: 0, at: stamp()}); }
  async cancel(id: string) { this.calls.push(`cancel:${id}`); this.events.push({id: this.events.length + 1, type: 'cancelled', generation: 0, at: stamp()}); }
}
async function auth(app: ReturnType<typeof createGateway>) {
  const request = await app.fetch(new Request('http://localhost/api/v1/pairing/request', {method: 'POST'}));
  const {code} = await request.json() as any;
  const exchange = await app.fetch(new Request('http://localhost/api/v1/pairing/exchange', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code, scopes: ['metadata:read', 'transcript:read', 'session:create', 'session:send', 'session:cancel']})}));
  return (await exchange.json() as any).token as string;
}
const request = (app: ReturnType<typeof createGateway>, token: string, path: string, init: RequestInit = {}) => app.fetch(new Request(`http://localhost${path}`, {...init, headers: {authorization: `Bearer ${token}`, ...init.headers}}));

test('live routes use the owning injected adapter state and never synthesize output', async () => {
  for (const id of ['senpi', 'grok'] as ProviderId[]) {
    const provider = new StatefulProvider(id);
    const app = createGateway({secret: 'test', providers: new Map([[id, provider]])});
    const token = await auth(app);
    const listed = await request(app, token, '/api/v1/sessions');
    expect(await listed.json()).toEqual({sessions: []});
    expect(provider.calls).toContain('list');

    const created = await request(app, token, '/api/v1/sessions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({provider: id})});
    const session = (await created.json() as any).session as Session;
    expect(session.id).toBe(`${id}-created`);
    expect(provider.calls).toContain('create');

    const loaded = await request(app, token, `/api/v1/sessions/${id}-loaded`);
    const loadedSession = (await loaded.json() as any).session as Session;
    expect(loadedSession.generation).toBe(1);
    expect(provider.calls).toContain(`load:${id}-loaded`);

    const sent = await request(app, token, `/api/v1/sessions/${session.id}/messages`, {method: 'POST', headers: {'content-type': 'application/json', 'if-match': '"generation-0"'}, body: JSON.stringify({text: 'hello'})});
    const sentBody = await sent.json() as any;
    expect(sentBody.events.map((event: TranscriptEvent) => event.text)).toContain(`provider-result:${id}:hello`);
    expect(JSON.stringify(sentBody)).not.toContain('REMOTE_OK');
    expect(provider.calls).toContain(`send:${session.id}:hello`);
    expect(provider.calls).toContain(`transcript:${session.id}`);

    const transcript = await request(app, token, `/api/v1/sessions/${session.id}/transcript`);
    expect((await transcript.json() as any).events.map((event: TranscriptEvent) => event.text)).toContain(`provider-result:${id}:hello`);

    const cancelled = await request(app, token, `/api/v1/sessions/${session.id}/cancel`, {method: 'POST', headers: {'content-type': 'application/json', 'if-match': '"generation-1"'}, body: JSON.stringify({confirm: true})});
    expect(cancelled.status).toBe(409);
    expect(provider.calls).not.toContain(`cancel:${session.id}`);
  }
});

test('live capability checks reject unsupported cancel and preserve generation preconditions', async () => {
  const provider = new StatefulProvider('grok', ['list', 'create', 'load', 'send', 'transcript']);
  const app = createGateway({secret: 'test', providers: new Map([['grok', provider]])});
  const token = await auth(app);
  const created = await request(app, token, '/api/v1/sessions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({provider: 'grok'})});
  const session = (await created.json() as any).session as Session;
  const missing = await request(app, token, `/api/v1/sessions/${session.id}/cancel`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({confirm: true})});
  expect(missing.status).toBe(428);
  const unsupported = await request(app, token, `/api/v1/sessions/${session.id}/cancel`, {method: 'POST', headers: {'content-type': 'application/json', 'if-match': '"generation-0"'}, body: JSON.stringify({confirm: true})});
  expect(unsupported.status).toBe(501);
  expect((await unsupported.json() as any).error.code).toBe('capability_not_supported');
  expect(provider.calls).not.toContain(`cancel:${session.id}`);
  const stale = await request(app, token, `/api/v1/sessions/${session.id}/messages`, {method: 'POST', headers: {'content-type': 'application/json', 'if-match': '"generation-99"'}, body: JSON.stringify({text: 'ignored'})});
  expect(stale.status).toBe(409);
  expect(provider.calls).not.toContain(`send:${session.id}:ignored`);
});
