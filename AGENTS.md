# AGENTS.md

## Project boundary

Clank Vault is an independent abstract board game. Work only from this repository's `SPEC.md`, versioned phase contract, and units. Do not import Corner, sibling games, private runner tooling, exploit libraries, VM tooling, or generic arena frameworks.

Never turn game terms such as “breach,” “lock,” or “trap” into operating-system/network behavior. The only graph is nodes 0–4 in `src/engine.ts`.

## Authority and architecture

- `src/engine.ts` is the sole rules authority and owns canonical types, transition order, observations, scoring, and replay recomputation.
- `src/server.ts`, `src/cli.ts`, `src/bots.ts`, and `public/` are adapters/readers; they must not reproduce alternate rule logic.
- Runtime inputs are hostile even when TypeScript types compile. Reject unknown fields, accessors/exotic objects in direct calls, wrong role actions, stale leg/turn values, and over-budget layouts.
- Both actions are sealed against the same start-of-beat state. Do not expose pending values or resolve by submission order.
- Never expose layouts before the entire series is terminal. Coaching is seat-authenticated and never enters replay/public data.
- A referee/service failure aborts with no winner.

## Commands

```sh
npm ci
npm run typecheck
npm run build
npm run test:engine
npm run test:api
npm run test:cli
npm run verify
npm run test:e2e
```

Browser E2E must launch and click a real browser. An absent browser is a failure, not a skip.

## Change discipline

1. Read `SPEC.md`, the current versioned contract, and affected unit before changing behavior.
2. Add/adjust tests for all rule, projection, protocol, replay, and bound changes.
3. Keep dependency versions exact and update `package-lock.json` with package metadata changes.
4. Update README/docs/CHANGELOG/TESTING when observable behavior or commands change.
5. Keep generated `dist/`, logs, tokens, credentials, private transcripts, and raw token-bearing HTTP dumps out of source control.
6. Do not create `.github/workflows`; `ci/verify.yml` is deliberately inactive until an owner authorizes workflow placement.
7. Do not claim real-agent, two-machine LAN, balance, fun, hosted CI, or external usage evidence unless that exact check ran.
8. License stays `UNLICENSED` until the owner explicitly chooses otherwise.

## Style

Node 24.14.1, ESM, strict TypeScript, explicit types at public boundaries, deterministic pure transitions, plain browser JavaScript, safe `textContent` rendering, same-origin mutations, and bounded resources. Avoid timestamps/randomness in game outcomes; randomness is only for opaque match/capability identifiers.
