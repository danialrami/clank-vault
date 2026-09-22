---
name: verify-clank-vault
description: Reproduce this repository's strict build, rules/API/CLI tests, deterministic replay checks, and real-browser click E2E.
---

# Verify Clank Vault

Run from the repository root with Node 24.14.1.

```sh
npm ci
npm run verify
npm run test:e2e
```

Focused diagnosis:

```sh
npm run typecheck
npm run build
npm run test:engine
npm run test:api
npm run test:cli
npm run verify:replay
```

Browser selection uses `CHROMIUM_PATH`, then pinned `@sparticuz/chromium`, then an installed Playwright Chromium. Missing/unlaunchable Chromium must fail, never skip.

## Failure checks

- A green non-browser gate without `npm run test:e2e` is not browser evidence.
- `ci/verify.yml` is an inactive staged template, not proof hosted CI ran.
- Never paste raw capability-bearing traffic into a report.
- Replay acceptance requires recomputed schema, legality, events, result, full final state, and hash.
- Keep real-agent, physical two-machine LAN, balance/fun, TLS, and provider claims pending unless those checks were actually performed.

Use `TESTING.md` for the evidence boundary and `BUILD_REPORT.md` for the latest local results.
