import {expect, test} from 'bun:test';
import {SenpiAdapter, type RpcPeer} from '../apps/gateway/src/providers';

type ThreadReadResponse = {thread: {id: string; turns?: unknown[]}; turns?: unknown[]};

function peer(response: ThreadReadResponse): RpcPeer {
  return {
    initialize: async () => {},
    close() {},
    request: async (method, params) => {
      expect(method).toBe('thread/read');
      expect(params).toEqual({threadId: 'persisted-thread', includeTurns: true});
      return response;
    },
    waitForNotification: async () => { throw new Error('not used'); },
  };
}

// Senpi 2026.7.14-3 thread/read resumes a persisted thread and returns its
// materialized turns at the response level. The thread object remains metadata.
const resumedThreadRead: ThreadReadResponse = {
  thread: {id: 'persisted-thread'},
  turns: [{
    id: 'turn-1',
    items: [
      {type: 'userMessage', id: 'user-1', content: [{type: 'text', text: 'persisted request'}]},
      {type: 'agentMessage', id: 'assistant-1', text: 'REMOTE_OK'},
      {type: 'commandExecution', id: 'tool-1', command: 'echo ignored', status: 'completed'},
    ],
  }],
};

test('maps the documented response-level turns returned by thread/read after restart', async () => {
  const adapter = new SenpiAdapter({}, async () => peer(resumedThreadRead));
  await expect(adapter.transcript('persisted-thread')).resolves.toMatchObject([
    {role: 'user', text: 'persisted request'},
    {role: 'assistant', text: 'REMOTE_OK'},
  ]);
});

test('maps text fields and text content arrays without rendering tool or status payloads', async () => {
  const adapter = new SenpiAdapter({}, async () => peer({
    thread: {
      id: 'persisted-thread',
      turns: [{
        id: 'turn-1',
        items: [
          {type: 'userMessage', content: [{type: 'text', text: 'user text'}, {type: 'image', url: 'ignored'}]},
          {type: 'agentMessage', text: 'agent text'},
          {type: 'assistantMessage', content: [{type: 'text', text: 'content-array assistant'}]},
          {type: 'agentMessage', content: [{type: 'text', text: 'content-array agent'}]},
          {type: 'mcpToolCall', result: {content: 'must not stringify'}},
          {type: 'commandExecution', aggregatedOutput: 'must not stringify'},
        ],
      }],
    },
  }));
  const transcript = await adapter.transcript('persisted-thread');
  expect(transcript.map(({role, text}) => ({role, text}))).toEqual([
    {role: 'user', text: 'user text'},
    {role: 'assistant', text: 'agent text'},
    {role: 'assistant', text: 'content-array assistant'},
    {role: 'assistant', text: 'content-array agent'},
  ]);
});

test('a new adapter maps a thread persisted by a prior adapter peer', async () => {
  let persisted: ThreadReadResponse | undefined;
  const writer: RpcPeer = {
    initialize: async () => {}, close() {},
    request: async method => {
      if (method === 'thread/resume') return {};
      if (method === 'turn/start') {
        persisted = resumedThreadRead;
        return {turn: {id: 'turn-1', status: 'inProgress'}};
      }
      throw new Error(`Unexpected ${method}`);
    },
    waitForNotification: async () => ({method: 'turn/completed', params: {threadId: 'persisted-thread', turn: {id: 'turn-1', status: 'completed'}}}),
  };
  const firstAdapter = new SenpiAdapter({}, async () => writer);
  await firstAdapter.send('persisted-thread', 'persist this');

  const restartedAdapter = new SenpiAdapter({}, async () => peer(persisted!));
  await expect(restartedAdapter.transcript('persisted-thread')).resolves.toEqual(expect.arrayContaining([
    expect.objectContaining({role: 'assistant', text: 'REMOTE_OK'}),
  ]));
});
