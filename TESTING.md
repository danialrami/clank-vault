# Testing

## Reproducible commands

From the repository root with Node 24.14.1:

```sh
npm ci
npm run verify
npm run test:e2e
```

Focused commands:

```sh
npm run typecheck
npm run build
npm run test:engine
npm run test:api
npm run test:cli
npm run verify:replay
```

`npm run verify` is the required non-browser gate: strict typecheck, clean build, all compiled Node tests, and a separate generated replay verification. `npm run test:e2e` rebuilds, launches a real Chromium executable, and clicks through the browser. It first uses `CHROMIUM_PATH` when set, then pinned `@sparticuz/chromium` on Linux, then the ordinary Playwright Chromium location. If launch fails, the command fails; there is no browser skip.

## Covered behavior

- Every raider/sentinel action family, lock hit/block/miss, scan, tool boundaries, trap once-only behavior, collision, hazard-before-extract, no-op take/extract, HP floor, beat-12 failure, and reset.
- Exact one-extraction/fewer-beats/greater-HP/equal/both-fail scoring.
- Valid maximal-budget fixture plus invalid duplicate/entry/over-budget/unsurvivable layouts and malicious runtime object shapes.
- Role swap and submission property/order equivalence.
- Raider/defender/public projections, private coaching isolation, sentinel proximity, active-layout sealing, pending-action sealing, and terminal disclosure.
- Replay recomputation plus action/event/result/final-state/hash/missing-field tamper rejection and zero-turn timeout replay.
- JSON/content/origin/body/match/SSE bounds; missing/bad bearers; wrong role; stale leg/turn; identical and conflicting retries.
- Prompt timeout and injected referee failure abort with no winner.
- Full external/external two-client HTTP and CLI series, role swap, terminal replay verification, and immutable rematch.
- Browser clicks: preset/budget, practice start/completion, visible map/resources/roles/result, replay step/download/verification, changed style/note, new rematch ID, and external-path copy.

## Latest local evidence

On Node 24.14.1 / npm 11.11.0, a frozen `npm ci` completed, `npm run verify` passed 24/24 Node tests plus the independent deterministic replay check, and `npm run test:e2e` passed with a real pinned `@sparticuz/chromium` process (including a 390 px mobile-fit check). The compact command summary and evidence boundary are recorded in `BUILD_REPORT.md`; no raw capability-bearing HTTP dump is retained.

## Not tested / not claimed

- No third-party harness certification or metered provider run; the separate Ciani CLI smoke below did run, with usage still unknown.
- No physical two-machine LAN test, TLS proxy test, Internet exposure, or browser matrix beyond the available headless Chromium.
- No human balance/fun/usability study and no ranked-fairness claim.
- No third-party pi/provider/MCP compatibility certification.
- `ci/verify.yml` is staged and inactive; local success is not hosted-CI evidence.

## Independent review — 2026-09-22

Fresh frozen installs, strict build/typecheck, API/CLI checks and real Chromium click E2E were rerun by the orchestrator, not accepted solely from the builder report. The game-only Ciani CLI smoke is recorded in [docs/external-agent-smoke.md](docs/external-agent-smoke.md); it supersedes the original blanket no-live-agent note, but does not certify a third-party harness, physical LAN or metered inference.

Review fixes: render/export zero-turn aborts in the browser without dereferencing a nonexistent turn; distinguish internal 500 failures from invalid input; allow bounded full replay HTTP verification up to 512 KiB (game mutations remain 16 KiB). New regression tests cover all three paths.

Final reviewed gate on 2026-09-22: **26 Node tests passed, zero failed/skipped**, strict build/typecheck passed, and the real browser E2E passed. The recorded Ciani replay also passes the compiled CLI verifier.
