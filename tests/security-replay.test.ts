import {expect, test} from 'bun:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {assertSafeBind, createGateway, issuePairingCode} from '../apps/gateway/src/app';

async function paired(app: ReturnType<typeof createGateway>, requested = ['metadata:read', 'transcript:read', 'session:create', 'session:send', 'session:cancel', 'token:manage']) {
  const request = await app.fetch(new Request('http://localhost/api/v1/pairing/request', {method: 'POST'}));
  const {code} = await request.json() as any;
  const exchange = await app.fetch(new Request('http://localhost/api/v1/pairing/exchange', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code, scopes: requested})}));
  return await exchange.json() as any;
}

test('production startup denies forged pairing requests but honors durable CLI-issued codes', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'omodesu-security-')), 'control.sqlite');
  const app = createGateway({secret: 'test', dbPath, fixtures: true, peerLoopback: () => false});
  const forged = await app.fetch(new Request('http://127.0.0.1/api/v1/pairing/request', {method: 'POST', headers: {host: '127.0.0.1'}}));
  expect(forged.status).toBe(403);
  const code = issuePairingCode(dbPath);
  const remote = await app.fetch(new Request('http://100.64.0.10/api/v1/pairing/exchange', {method: 'POST', headers: {'content-type': 'application/json', host: '100.64.0.10'}, body: JSON.stringify({code, scopes: ['metadata:read']})}));
  expect(remote.status).toBe(200);
  rmSync(dirname(dbPath), {recursive: true, force: true});
});

test('pairing is one-use, scopes are enforced, and unsafe bind fails', async () => {
  const app = createGateway({secret: 'test', fixtures: true});
  const request = await app.fetch(new Request('http://localhost/api/v1/pairing/request', {method: 'POST'}));
  const {code} = await request.json() as any;
  const exchange = () => app.fetch(new Request('http://localhost/api/v1/pairing/exchange', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code, scopes: ['metadata:read']})}));
  expect((await exchange()).status).toBe(200);
  expect((await exchange()).status).toBe(400);
  expect(() => assertSafeBind('0.0.0.0')).toThrow();
});

test('signed replay cursor is current for its emitted generation and stale after a later send', async () => {
  const app = createGateway({secret: 'test', fixtures: true});
  const device = await paired(app);
  const headers = {authorization: `Bearer ${device.token}`};
  const created = await app.fetch(new Request('http://localhost/api/v1/sessions', {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({provider: 'grok'})}));
  const session = (await created.json() as any).session;
  const sent = await app.fetch(new Request(`http://localhost/api/v1/sessions/${session.id}/messages`, {method: 'POST', headers: {...headers, 'content-type': 'application/json', 'if-match': '"generation-0"'}, body: JSON.stringify({text: 'REMOTE_OK'})}));
  expect(sent.status).toBe(200);
  const replay = await app.fetch(new Request(`http://localhost/api/v1/sessions/${session.id}/events`, {headers}));
  const output = await replay.text();
  const cursor = JSON.parse(output.match(/event: cursor\ndata: (.+)/)?.[1] ?? '{}').cursor;
  const reconnect = await app.fetch(new Request(`http://localhost/api/v1/sessions/${session.id}/events?cursor=${encodeURIComponent(cursor)}`, {headers}));
  expect(reconnect.status).toBe(200);
  const staleCancel = await app.fetch(new Request(`http://localhost/api/v1/sessions/${session.id}/cancel`, {method: 'POST', headers: {...headers, 'content-type': 'application/json', 'if-match': '"generation-0"'}, body: JSON.stringify({confirm: true})}));
  expect(staleCancel.status).toBe(409);
  const resent = await app.fetch(new Request(`http://localhost/api/v1/sessions/${session.id}/messages`, {method: 'POST', headers: {...headers, 'content-type': 'application/json', 'if-match': '"generation-1"'}, body: JSON.stringify({text: 'REMOTE_OK_AGAIN'})}));
  expect(resent.status).toBe(200);
  const stale = await app.fetch(new Request(`http://localhost/api/v1/sessions/${session.id}/events?cursor=${encodeURIComponent(cursor)}`, {headers}));
  expect(stale.status).toBe(409);
});
