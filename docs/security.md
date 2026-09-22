# Security model and bounds

## Intended boundary

The host and trusted LAN are trusted. Anyone who can reach the server may create a match until the small process cap is reached. Seat and host bearer tokens are capabilities. This is not hardened public hosting, matchmaking, anti-cheat, or a malicious-host privacy boundary.

Game concepts are abstract data only. The server has no uploaded plugins, arbitrary JavaScript execution, shell/exploit invocation, VM integration, real credentials, provider calls, or network target input.

## Hidden information

- Seat bearers gate observations and actions.
- Active public views/SSE disclose only revealed facts; `layouts` is `null` until the entire series is terminal.
- Raider observations omit fortress configuration and hide a non-nearby sentinel.
- Defender observations disclose only its own active fortress and public raid resources.
- Pending actions are stored server-side and are never projected to either opponent/public endpoint.
- Coaching notes (maximum 1000 characters) appear only in that seat's authenticated observation.
- Terminal replay omits capabilities and raw coaching; both layouts unlock only after completion/abort.
- Rejected private values are not logged. Fastify logging is disabled by default.

A bearer holder can act as that seat. Bearers are returned at creation/rematch and remain in memory; the browser never puts them in URLs. Do not share them through logs, screenshots, history, or untrusted agents.

## Input and protocol controls

- Strict runtime validation rejects unknown fields, wrong types/roles/targets, duplicate defense entries, over-budget/unsurvivable layouts, stale leg/turn, conflicting request IDs, and malformed replay objects.
- Direct engine validation rejects exotic prototypes and accessor properties rather than invoking attacker getters.
- JSON mutation bodies are capped at 16 KiB; replay files read by the CLI are capped at 1 MiB.
- Same-origin browser mutations are required when `Origin` is present; foreign/malformed origins are rejected.
- Static HTML uses a restrictive CSP, no inline script, and dynamic strings render through `textContent`.
- Tokens never belong in query parameters. POST requires JSON.
- Replay verification recomputes actions, events, result, full final state, and digest; it does not trust a supplied hash.

## Resource bounds

- Default match cap: 32 process-lifetime matches (configurable downward/up to a hard constructor bound).
- Maximum 24 resolved turns per complete series and bounded event fan-out per turn.
- Request body: 16 KiB; coaching: 1000 characters; name: 120; request ID: 100.
- Default turn deadline: 60 seconds; constructor accepts 10 ms–1 hour. A test clock is injectable.
- Default SSE cap: 8 per match, hard constructor maximum 32; connections/heartbeats are cleaned on close.
- Receipt/history/config sizes are bounded by turn/action/config limits.
- Built-in policy loop is hard-bounded at 24 turns. There are no unbounded agent loops.
- State is ephemeral in memory. Completed entries still count toward the process match cap so memory cannot silently grow without bound.

## Failure semantics

A deadline aborts the whole series with reason `turn-timeout`, no winner. An unexpected referee or scripted-policy exception aborts with `server-error`, no winner, and closes live SSE clients before publishing terminal state. Shutdown abort is available in the canonical engine/replay model. Failures are never converted to tactical wins.

## LAN cautions

Loopback is the default. Binding `0.0.0.0` is explicit and prints a warning. HTTP bearer tokens are not encrypted in transit. Use only a trusted LAN or deploy a trusted TLS reverse proxy; v1 does not configure certificates, identity, firewall rules, or Internet exposure.

## Reporting

Do not include private transcripts, credentials, capability values, or raw token-bearing traffic in issues/reports. Redact match IDs if they are correlated with private test sessions, even though IDs alone are not seat capabilities.
