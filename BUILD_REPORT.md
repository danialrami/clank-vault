# Clank Vault v1 build report

## Status

**Implemented and locally passing.** Work is contained in `/agent/workspace/clank-vault`. No GitHub write, remote branch, platform configuration, published artifact, external provider call, or skill/config mutation was performed.

Authoritative inputs read before implementation: root `SPEC.md`, phase `docs/specs/2026-09-21T0520Z_lan-first-v1/SPEC.md`, all five unit files, and `contract-review.md`.

## Delivered behavior

- Strict Node 24.14.1 ESM TypeScript referee for the exact five-node graph, four-point private fortress layouts, simultaneous raid/sentinel actions, hazards, two 12-beat legs, reset/role swap, and exact extraction scoring.
- Runtime config/action/replay validation (unknown fields, exotic/accessor/sparse runtime data, budget/reachability, role/legal action, stale leg/turn) with deterministic transitions.
- Raider, defender, and public projections. Active public/SSE data has no private layouts, coaching, capability tokens, or pending action values. Both layouts unlock only at terminal series state.
- Replay exports rules/config/actions/events/result/full final state plus SHA-256; verification recomputes the complete sequence and fails on schema, action, event, result, final-state, missing-field, or hash tampering.
- Bounded Fastify service: 16 KiB mutation body, 32-match default cap, 8-SSE default cap, at most 24 game turns, bounded strings/receipts/history, clean SSE/timer close, 60-second default injectable deadline, bearer seats/host, idempotent identical retries, foreign-Origin rejection, immutable rematch, and no-winner timeout/server-error abort.
- CLI `serve`, `rules`, `create`, `observe`, `act`, `replay`, `verify`, `demo`; JSON envelopes and documented exits 0/2/3/5; token values only via named environment variables.
- Deterministic scripted practice (`direct`/`cautious` raider; `patrol`/`pursuit` sentinel), honestly labeled scripted with `externalUsage: null`. Baseline demo includes extraction.
- Responsive plain browser UI with five labeled nodes, unknown/revealed defense facts, roles/leg/beat/tools/HP/core, layout preset/editor and budget, scripted/manual/external modes, authenticated click actions, public timeline, completed legs, result, replay stepping/download, and immutable rematch.
- Required README, AGENTS, CHANGELOG, TESTING, rules/protocol/security/usage docs, maximal/invalid fixtures, two project-scoped skills, exact package/Node pins, lockfile, UNLICENSED notice, and SHA-pinned inactive `ci/verify.yml` staged template.

## Local commands and results

Environment: Node `v24.14.1`, npm `11.11.0`.

```text
npm ci
PASS — frozen install, 73 packages

npm run verify
PASS — strict typecheck + clean build
PASS — 24 Node tests, 24 passed / 0 failed / 0 skipped
PASS — engine branches, scoring, role swap, hidden views, API/CLI full series,
       idempotency/stale/bad auth/input, bounds, timeout/server abort, replay tamper
PASS — extra deterministic 12-turn replay verification
       digest 65f8b97ddb148e8ee24e698415faf7815dd21c6888dc24874ba917a2e23525dc

npm run test:e2e
PASS — real headless Chromium launched through pinned @sparticuz/chromium
PASS — browser clicks selected presets, started/completed practice, showed map/resources/result,
       stepped and downloaded a replay verified by the engine, changed note/style,
       created a new rematch, checked external-agent copy, and checked 390px mobile fit
```

Focused engine/API/CLI commands also passed during iteration. Tests close their Fastify instances, SSE clients, timers, browser/context, and temporary files; no Clank Vault test server remained running after verification.

## Contract corrections and deviations

- **Spec corrections:** none. No authoritative contract bug was encountered, so specification files were not changed.
- **Implementation deviations:** none known from the v1 contract.
- The contract's explicit scope choices remain: no provider-specific/MCP adapter, no arbitrary agents/plugins, no persistence, no public hosting/ranked fairness, and staged CI is not active.
- Package remains `UNLICENSED`; no license grant was invented.

## Evidence boundary / pending work

Not run and not claimed:

1. A real model-backed/game-only agent (including pi) consuming the CLI/HTTP loop.
2. A physical two-machine LAN session or TLS reverse-proxy deployment.
3. A human manual playtest/usability, balance, or fun assessment.
4. Cross-browser/OS coverage beyond the available Linux headless Chromium.
5. Hosted CI execution; `ci/verify.yml` requires authorized placement under `.github/workflows` before it can run.

Same-machine automated API/CLI/browser evidence validates the implementation and projections, not a malicious host, third-party agent product, public deployment, or game balance.

## Independent review — 2026-09-22 (supersedes the original evidence boundary)

The orchestrator reread the code, reran clean installs and verification, exercised real browser controls, and ran an actual Ciani external seat through the CLI. See docs/external-agent-smoke.md and its replay fixture. Third-party harnesses, two physical machines, fun/balance and enabled CI remain unverified.

Review fixes: render/export zero-turn aborts in the browser without dereferencing a nonexistent turn; distinguish internal 500 failures from invalid input; allow bounded full replay HTTP verification up to 512 KiB (game mutations remain 16 KiB). New regression tests cover all three paths.

Final reviewed gate: 26 Node tests passed, no failures/skips; strict build, replay recomputation and real browser E2E passed on 2026-09-22. See the numbered issue #1 for open follow-ups.
