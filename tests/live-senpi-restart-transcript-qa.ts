import {SenpiAdapter} from '../apps/gateway/src/providers';

const sessionDir = `${process.cwd()}/.omo/qa-homes/final/sessions`;
const adapter = new SenpiAdapter({...process.env, SENPI_CODING_AGENT_SESSION_DIR: sessionDir});
try {
  const sessions = await adapter.list();
  let selected = false;
  let remoteOk = false;
  let transcriptsRead = 0;
  let eventsRead = 0;
  for (const session of sessions) {
    const transcript = await adapter.transcript(session.id);
    transcriptsRead += 1;
    eventsRead += transcript.length;
    const found = transcript.some(event => event.role === 'assistant' && event.text === 'REMOTE_OK');
    selected ||= found;
    remoteOk ||= found;
  }
  const evidence = [
    'senpi_version=2026.7.14-3',
    'session_dir_exists=true',
    `listed_sessions=${sessions.length}`,
    `transcripts_read=${transcriptsRead}`,
    `transcript_event_count=${eventsRead}`,
    `selected_session=${selected}`,
    `assistant_REMOTE_OK=${remoteOk}`,
    'transcript_content=not recorded',
  ].join('\n');
  await Bun.write('.omo/evidence/omodesu/C3-control/senpi-restart-transcript.txt', `${evidence}\n`);
  if (!remoteOk) throw new Error('No persisted Senpi transcript contained the expected assistant marker');
} finally {
  await adapter.close();
  process.exit(process.exitCode ?? 0);
}
