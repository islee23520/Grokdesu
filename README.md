# Omodesu

A loopback-first local companion gateway and installable PWA. It deliberately owns only control metadata: tokens, pairing state, capability records, generation counters, and audit metadata. Provider transcripts remain provider-owned.

## Run

```sh
bun install
bun run typecheck && bun test && bun run build\n# for browser QA, start the gateway on 127.0.0.1:8791 then run: bun run qa:browser
bun --cwd apps/gateway run start
# Serve apps/web/dist behind the same loopback origin, or use Vite in development.
```

The gateway defaults to `127.0.0.1:8787` and refuses wildcard or non-loopback binds. Use `tailscale serve` to expose this private local origin remotely; never bind the process directly to a public interface.

## API and pairing

All endpoints live under `/api/v1`. In normal production startup the gateway disables `POST /pairing/request`; start a local terminal with `bun apps/gateway/src/index.ts pair` to print a one-use five-minute code, then exchange it at `/pairing/exchange`. Remote PWA users on a Tailscale-served origin manually enter that code and retain the returned bearer token locally. The gateway stores only SHA-256 token hashes. State-changing session requests require `If-Match: "generation-N"`; missing is 428 and stale is 409. A send atomically reserves generation `N+1` and marks its durable session `streaming` before calling the provider. Cancel additionally requires `session:cancel` and `{ "confirm": true }`; while that stream is active, it accepts either active `N+1` or the immediately prior client-known `N`, atomically claims the stream as `cancelling`, and preserves generation. This compatibility window closes when the send completes, so prior `N` is then stale. Unsupported providers are rejected before any cancellation state is reserved.

Live Senpi (`app-server --listen stdio://`) and Grok adapters are implemented. Senpi waits for the matching terminal `turn/completed` notification before reading a transcript. Grok's current QA authentication blocker is environment-specific. Deterministic fixture sessions remain available only when `OMODESU_FIXTURES=1`; production startup uses live adapters.

## Security

`Cache-Control: no-store`, `nosniff`, no-referrer, and a same-origin CSP are set for API responses. Never log Authorization headers, bearer tokens, pairing codes, signed cursors, or environment fields matching TOKEN, KEY, SECRET, or PASSWORD. The PWA stores its device token and device ID in IndexedDB; logging out removes that record. Use a browser/OS-protected profile in addition to gateway token revocation.

## QA isolation

Use an isolated `SENPI_CODING_AGENT_SESSION_DIR` beneath `.omo/qa-homes` for Senpi runtime QA while preserving the normal authenticated coding-agent directory. Do not write or inspect provider transcript/session files. Evidence is in `.omo/evidence/omodesu`.
