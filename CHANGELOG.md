# Changelog

## 1.0.0 — LAN-first v1

### Added

- Fixed five-node `vault-1` referee with budgeted private fortresses, simultaneous sealed actions, hazards, role swap, exact two-leg scoring, runtime validation, and bounded state/history.
- Seat-specific and public hidden-information projections.
- Deterministic replay export with action/event/result/final-state recomputation and SHA-256 comparison; malformed or tampered replays fail closed.
- Fastify HTTP API with bearer seat/host capabilities, idempotent request IDs, stale/conflict rejection, deadlines, server-failure aborts, match/SSE/body bounds, redacted public SSE, terminal replay, and immutable rematches.
- CLI for serving, rules, match creation, observation, action submission, replay export/verification, and a local scripted demo.
- Deterministic role-aware scripted practice policies (`direct`, `cautious`, `patrol`, `pursuit`) with null/unverified external usage.
- Responsive browser board, layout preset/editor, manual/external route, practice start, public revelations, role/resource status, replay stepping/download, and rematch.
- Strict unit, HTTP integration, CLI integration, deadline/failure, hidden-state, tamper, resource-bound, and real-browser click E2E tests.
- Usage/rules/protocol/security/testing documentation, repository-specific play/verify skills, Node/dependency pins, lockfile, and inactive staged CI template.

### Explicit scope

- No provider-specific or MCP adapter; external seats use the documented CLI/HTTP protocol.
- No arbitrary uploaded agents, real exploit/VM behavior, persistence, matchmaking, public-ranked fairness, or metered same-model class.
- No real-agent, physical two-machine LAN, balance, or fun claim.
- License remains `UNLICENSED`.

### Pre-release review fixes — 2026-09-22

- Fixed zero-turn aborted replay display and internal HTTP error classification.
- Raised the optional replay-verification endpoint limit to a bounded 512 KiB so valid exported replays are accepted; other mutations remain 16 KiB.
- Recorded an external Ciani CLI series with both roles and independently verified its replay.
