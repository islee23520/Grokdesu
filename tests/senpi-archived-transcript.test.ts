import {expect, test} from 'bun:test';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SenpiAdapter, type RpcPeer} from '../apps/gateway/src/providers';

const archivedTranscript = [
  {type: 'session', version: 3, id: 'archived-thread', timestamp: '2026-07-16T00:00:00.000Z', cwd: '/work'},
  {type: 'custom', customType: 'ignored', data: {text: 'do not expose'}, id: 'custom-1', parentId: null, timestamp: '2026-07-16T00:00:01.000Z'},
  {type: 'message', id: 'user-1', parentId: 'custom-1', timestamp: '2026-07-16T00:00:02.000Z', message: {role: 'user', content: [{type: 'text', text: 'persisted request'}]}},
  {type: 'message', id: 'assistant-1', parentId: 'user-1', timestamp: '2026-07-16T00:00:03.000Z', message: {role: 'assistant', content: [{type: 'thinking', thinking: 'ignored'}, {type: 'text', text: 'REMOTE_OK'}]}},
  {type: 'message', id: 'tool-1', parentId: 'assistant-1', timestamp: '2026-07-16T00:00:04.000Z', message: {role: 'tool', content: [{type: 'text', text: 'tool result'}]}},
].map(entry => JSON.stringify(entry)).join('\n');

function peer(path: string): RpcPeer {
  return {
    initialize: async () => {}, close() {}, waitForNotification: async () => { throw new Error('not used'); },
    request: async (method, params) => {
      if (method === 'thread/list') return {data: [{id: 'archived-thread', path, cwd: '/work', updatedAt: 0, status: {type: 'idle'}}]};
      if (method === 'thread/read') {
        expect(params).toEqual({threadId: 'archived-thread', includeTurns: true});
        // Senpi's cold-restart read deliberately fabricates only an empty user item.
        return {thread: {id: 'archived-thread', turns: [{items: [{type: 'userMessage', content: []}]}]}};
      }
      throw new Error(`Unexpected ${method}`);
    },
  };
}

test('reads public archived message entries when cold thread/read has only fabricated empty user items', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omodesu-senpi-sessions-'));
  const path = join(root, 'archived-thread.jsonl');
  await writeFile(path, archivedTranscript, 'utf8');
  const adapter = new SenpiAdapter({SENPI_CODING_AGENT_SESSION_DIR: root}, async () => peer(path));

  await adapter.list();
  const transcript = await adapter.transcript('archived-thread');

  expect(transcript.map(({role, text}) => ({role, text}))).toEqual([
    {role: 'user', text: 'persisted request'},
    {role: 'assistant', text: 'REMOTE_OK'},
  ]);
});

test('rejects provider-reported session paths outside the configured session root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omodesu-senpi-sessions-'));
  const outside = await mkdtemp(join(tmpdir(), 'omodesu-senpi-outside-'));
  const path = join(outside, 'archived-thread.jsonl');
  await writeFile(path, archivedTranscript, 'utf8');
  const adapter = new SenpiAdapter({SENPI_CODING_AGENT_SESSION_DIR: root}, async () => peer(path));

  await expect(adapter.list()).rejects.toThrow('Provider unavailable/read failed');
});

test('does not persist archived transcript content to a control database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omodesu-senpi-sessions-'));
  await mkdir(root, {recursive: true});
  const source = await Bun.file('apps/gateway/src/app.ts').text();
  expect(source).not.toContain('INSERT INTO transcript');
  expect(source).not.toContain('CREATE TABLE transcript');
});
