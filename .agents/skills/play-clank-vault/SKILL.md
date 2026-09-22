---
name: play-clank-vault
description: Start and play this repository's Clank Vault board game through its browser, CLI, or authenticated external-seat loop.
---

# Play Clank Vault

Run from the repository root.

## Browser/scripted practice

```sh
npm ci
npm run build
node dist/src/cli.js serve
```

Open `http://127.0.0.1:3210`, configure both private layouts, keep both controllers on **Scripted practice**, and click **Start practice series**. Built-ins are deterministic scripted policies, not LLMs. After terminal state, inspect/download replay and rematch.

## External seat

```sh
node dist/src/cli.js create --url http://127.0.0.1:3210 --config examples/external-match.json --json
export CLANK_A_TOKEN='returned A capability'
node dist/src/cli.js observe --url http://127.0.0.1:3210 --match MATCH_ID --token-env CLANK_A_TOKEN --json
node dist/src/cli.js act --url http://127.0.0.1:3210 --match MATCH_ID --leg LEG --turn TURN \
  --action 'ONE_LEGAL_ACTION_JSON' --request-id A-N --token-env CLANK_A_TOKEN --json
```

Repeat observe/act with current identifiers. Never put a token in an argument, URL, log, or replay. A waiting response means the action is sealed; do not change it under the same request ID.

## Failure checks

- Stop if observation reports terminal state.
- Treat stale/wrong-leg/conflicting duplicate as a client bug; fetch a fresh observation.
- Treat timeout/server error as a global abort with no winner.
- Do not inspect another seat's environment/private observation.
- Do not invoke real security tools; all lock/trap/breach terms are board data.

See `docs/usage.md`, `docs/rules.md`, and `docs/protocol.md` rather than duplicating their full contract here.
