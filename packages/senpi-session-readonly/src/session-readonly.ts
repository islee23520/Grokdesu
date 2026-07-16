export type SessionEntry = {type?: unknown};

/**
 * Read-only public session parser compatible with Senpi 2026.7.14-3.
 * It intentionally skips malformed JSONL records and never opens or mutates sessions.
 */
export function parseSessionEntries(content: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  for (const line of content.trim().split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line) as SessionEntry); } catch {}
  }
  return entries;
}
