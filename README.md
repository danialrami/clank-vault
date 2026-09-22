# Clank Vault

Clank Vault is a small, self-contained hidden-information **board game** for two seats on one machine or a trusted LAN. Each seat builds a private fortress on the same five-node abstract graph, raids the other fortress, then guards its own. Simultaneous actions are sealed by the server, the roles swap after leg 1, and a deterministic terminal replay explains every transition.

This project never runs real exploits, VMs, pentesting tools, credentials, or uploaded code.

## What v1 contains

- Canonical strict-TypeScript `vault-1` referee with runtime validation.
- Two-leg raid, exact extraction scoring, hidden seat/public projections, and deterministic replay verification.
- Bounded in-memory Fastify service with bearer seat capabilities, idempotent action retries, deadlines, redacted SSE, and immutable rematches.
- CLI commands: `serve`, `rules`, `create`, `observe`, `act`, `replay`, `verify`, and `demo`.
- Plain responsive browser client with a five-node map, layout editor/presets, scripted or external seats, manual legal actions, public revelations, replay stepping/download, and rematch.
- Deterministic `direct`/`cautious` raiders and `patrol`/`pursuit` sentinels. These are **scripted policies, not LLMs**. External compute/usage is unverified/null.

## Requirements

- Node **24.14.1** (see `.node-version`)
- npm 11
- A Chromium executable for browser E2E. Linux installs use pinned `@sparticuz/chromium`; ordinary Playwright Chromium or `CHROMIUM_PATH` is also supported.

## Install and verify

```sh
npm ci
npm run verify
npm run test:e2e
```

`npm run verify` performs strict typechecking, a clean build, engine/API/CLI tests, and an additional deterministic replay check. `npm run test:e2e` launches a real Chromium process and clicks through practice, replay, changed style/note, and rematch. Missing Chromium is a failure, never a green skip.

## Quickstart

```sh
npm ci
npm run build
node dist/src/cli.js serve
```

Open <http://127.0.0.1:3210>. The default browser setup is a scripted practice series; click **Start practice series**, inspect the result, then inspect/download the replay.

The standalone deterministic CLI demo needs no server or provider key:

```sh
node dist/src/cli.js demo --json
```

## Trusted-LAN hosting

Loopback is the default. To listen on every interface, opt in explicitly:

```sh
node dist/src/cli.js serve --host 0.0.0.0 --port 3210
```

The CLI prints a LAN warning. Share `http://HOST:3210` only on a trusted LAN. Bearer capabilities are authorization tokens, **not transport encryption**; put a trusted TLS reverse proxy in front if traffic can leave the trusted network. Do not put tokens in URLs, logs, screenshots, or chat.

State is bounded and memory-only. Export a terminal replay if it must survive restart. Full layouts and replay are sealed until the entire series completes or aborts.

## External or manual seats

Choose **Manual / external** in the browser for click controls, or use the HTTP/CLI protocol. Tokens are returned once at match creation. The CLI reads them from the environment variable named by `--token-env`, never from a token command-line argument:

```sh
node dist/src/cli.js create --url http://127.0.0.1:3210 --config examples/external-match.json --json
export CLANK_A_TOKEN='value returned for seat A'
node dist/src/cli.js observe --url http://127.0.0.1:3210 --match MATCH_ID --token-env CLANK_A_TOKEN --json
node dist/src/cli.js act --url http://127.0.0.1:3210 --match MATCH_ID --leg 1 --turn 1 \
  --action '{"type":"move","target":1}' --request-id a-1 --token-env CLANK_A_TOKEN --json
```

A shell-capable, game-only agent can repeat `observe` → select one listed legal action → `act`. Generic protocol tests do not certify pi or any third-party agent. See [docs/usage.md](docs/usage.md) and [docs/protocol.md](docs/protocol.md).

## Documentation

- [Rules](docs/rules.md)
- [Usage and external-seat loop](docs/usage.md)
- [HTTP/CLI protocol](docs/protocol.md)
- [Security and limits](docs/security.md)
- [Testing evidence and limitations](TESTING.md)
- [Authoritative phase contract](docs/specs/2026-09-21T0520Z_lan-first-v1/SPEC.md)

## CI and license status

`ci/verify.yml` is a SHA-pinned **staged template only**. It is not active CI because it is intentionally not under `.github/workflows`; placement there requires repository workflow authorization. No checks are claimed from that file.

The package is **UNLICENSED**. No permission grant is implied; the owner has not selected a public license.

## v1 review evidence and next checks

See [the recorded external-agent smoke](docs/external-agent-smoke.md), [the phase contracts](docs/specs/2026-09-21T0520Z_lan-first-v1/SPEC.md), [CHANGELOG](CHANGELOG.md), and [follow-ups #1](https://github.com/danialrami/clank-vault/issues/1). The [research suite PR](https://github.com/lufs-audio/kb/pull/261) is in the private KB and remains pending CI; it is not needed to build or play.

Both games default to port 3210. When running both together, start Vault with `node dist/src/cli.js serve --port 3211` and open that port.
