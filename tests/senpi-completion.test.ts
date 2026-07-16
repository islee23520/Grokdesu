import {expect, test} from 'bun:test';
import {NdjsonRpc, SenpiAdapter, type RpcPeer} from '../apps/gateway/src/providers';

type LineTransport = {
  stdin: {write(value: string): void};
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return {promise: new Promise<T>((res, rej) => { resolve = res; reject = rej; }), resolve, reject};
}

function transport() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const writes: any[] = [];
  const result = {writes, transport: {
    stdin: {write(value: string) { writes.push(JSON.parse(value)); }},
    stdout: new ReadableStream<Uint8Array>({start(value) { controller = value; }}),
    exited: new Promise<number>(() => {}),
    kill() { controller.close(); },
  } satisfies LineTransport, notify(value: unknown) { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`)); }};
  return result;
}

test('NdjsonRpc buffers a completion notification emitted before turn/start response consumer registers its turn id', async () => {
  const fake = transport();
  const rpc = new NdjsonRpc(fake.transport);
  const request = rpc.request('turn/start', {threadId: 'thread-a'});
  fake.notify({method: 'turn/completed', params: {threadId: 'thread-a', turn: {id: 'turn-a', status: 'completed'}}});
  fake.notify({id: 1, result: {turn: {id: 'turn-a', status: 'inProgress'}}});
  const started = await request;
  await expect(rpc.waitForNotification(message => message.method === 'turn/completed' && message.params?.threadId === 'thread-a' && message.params?.turn?.id === started.turn.id, 100)).resolves.toMatchObject({params: {turn: {id: 'turn-a'}}});
  rpc.close();
});

test('SenpiAdapter waits for its matching terminal completion before transcript can be read', async () => {
  let completed = false;
  const completionWait = deferred<any>();
  const calls: string[] = [];
  const rpc: RpcPeer = {
    initialize: async () => {}, close() {},
    request: async (method, params) => {
      calls.push(method);
      if (method === 'thread/resume') return {};
      if (method === 'turn/start') return {turn: {id: 'turn-a', status: 'inProgress'}};
      if (method === 'thread/read') { expect(completed).toBeTrue(); return {thread: {turns: []}}; }
      throw new Error(`Unexpected ${method}`);
    },
    waitForNotification: async predicate => {
      const notification = await completionWait.promise;
      expect(predicate({method: 'turn/completed', params: {threadId: 'other-thread', turn: {id: 'turn-a', status: 'completed'}}})).toBeFalse();
      expect(predicate({method: 'turn/completed', params: {threadId: 'thread-a', turn: {id: 'other-turn', status: 'completed'}}})).toBeFalse();
      expect(predicate(notification)).toBeTrue();
      completed = true;
      return notification;
    },
  };
  const adapter = new SenpiAdapter({}, async () => rpc);
  const sending = adapter.send('thread-a', 'hello');
  while (calls.length < 2) await Promise.resolve();
  expect(calls).toEqual(['thread/resume', 'turn/start']);
  completionWait.resolve({method: 'turn/completed', params: {threadId: 'thread-a', turn: {id: 'turn-a', status: 'completed'}}});
  await sending;
  await adapter.transcript('thread-a');
  expect(calls).toEqual(['thread/resume', 'turn/start', 'thread/read']);
});

test('SenpiAdapter rejects failed and interrupted terminal turns and clears only at terminal completion', async () => {
  for (const status of ['failed', 'interrupted']) {
    const requests: Array<{method: string; params: any}> = [];
    let completion!: (message: any) => void;
    const rpc: RpcPeer = {
      initialize: async () => {}, close() {},
      request: async (method, params) => { requests.push({method, params}); if (method === 'turn/start') return {turn: {id: 'active-turn', status: 'inProgress'}}; return {}; },
      waitForNotification: predicate => new Promise(resolve => { completion = message => { if (predicate(message)) resolve(message); }; }),
    };
    const adapter = new SenpiAdapter({}, async () => rpc);
    const sending = adapter.send('thread-a', 'hello');
    while (requests.length < 2) await Promise.resolve();
    await Promise.resolve();
    await adapter.cancel('thread-a');
    expect(requests.at(-1)).toEqual({method: 'turn/interrupt', params: {threadId: 'thread-a', turnId: 'active-turn'}});
    completion({method: 'turn/completed', params: {threadId: 'thread-a', turn: {id: 'active-turn', status, error: {message: 'provider detail'}}}});
    await expect(sending).rejects.toThrow(status);
    await expect(adapter.cancel('thread-a')).rejects.toThrow('no active Senpi turn');
  }
});
