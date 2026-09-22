# HTTP and CLI protocol

Default base URL: `http://127.0.0.1:3210`. Game mutation bodies are JSON and capped at 16 KiB; the optional replay-verification endpoint accepts up to 512 KiB. Mutation requests with a foreign `Origin` are rejected. Except SSE, static assets, and raw replay downloads, responses use:

```json
{ "status": "success", "data": {} }
```

or:

```json
{ "status": "error", "code": 409, "message": "stale turn" }
```

Typical codes: 400 invalid contract, 401 missing/invalid bearer, 403 foreign origin, 404 unknown match, 409 state conflict, 413 oversized body, 415 non-JSON mutation, 429 capacity, 500 referee failure (the match is aborted with no winner).

## Routes

### `GET /api/status`

Reports game/package/rules versions, ready process state, ephemeral storage, and bounded in-memory match counts. It is not a liveness promise for an external supervisor.

### `GET /api/rules`

Machine-readable graph, limits, action grammar, resolution order, and scoring summary.

### `POST /api/matches`

Body is a validated `MatchConfig`:

```json
{
  "name": "Example",
  "layouts": {
    "A": { "core": 3, "locks": [1], "traps": [2] },
    "B": { "core": 4, "locks": [2, 3], "traps": [1, 4] }
  },
  "coaching": { "A": "private, up to 1000 chars", "B": "" },
  "entrants": { "A": "external", "B": "scripted" },
  "styles": {
    "A": { "raider": "cautious", "sentinel": "pursuit" },
    "B": { "raider": "direct", "sentinel": "patrol" }
  }
}
```

Returns `id`, `hostToken`, seat `tokens {A,B}`, and public `view`. Treat capabilities as secrets. A scripted seat is server-owned and rejects external actions. If both seats are scripted, creation runs the bounded deterministic series before responding.

### `GET /api/matches/:id`

Public redacted snapshot. Active snapshots contain no layouts, capabilities, coaching, or pending action values. They do contain roles, raider public resources, revealed facts, public events, completed legs, and scripted-style labels.

### `GET /api/matches/:id/observe`

Requires `Authorization: Bearer SEAT_TOKEN`. Returns match/leg/turn/role identifiers, that seat's `observation`, current `legalActions`, its own `coachingNote`, entrant mode, and `externalUsage: null`. The defender observation includes its active fortress and raider resources; a raider gets only accumulated facts and a proximity-gated sentinel position.

### `POST /api/matches/:id/actions`

Requires the seat bearer. Exact body:

```json
{
  "leg": 1,
  "turn": 1,
  "action": { "type": "move", "target": 1 },
  "requestId": "seat-a-1"
}
```

`requestId` is 1–100 characters from `[A-Za-z0-9._:-]`. An accepted identical retry is idempotent; reuse with different leg/turn/action is a 409 conflict. Wrong leg, stale turn, duplicate pending submission, unknown field, wrong-role action, or illegal target never advances state.

The first external action is sealed and returns `waiting: true`. It is not reflected in public/opponent observations. Resolution occurs only when both seats are present, counting a documented server-owned scripted action. Submission order does not affect the transition.

Action grammar:

```text
Raider:   {type:"move"|"breach"|"scan",target:0..4}
           {type:"rest"|"take"|"extract"}
Sentinel: {type:"move",target:0..4} | {type:"wait"}
```

Use the returned `legalActions`; adjacency, tool availability, and role are state-dependent.

### `GET /api/matches/:id/stream`

Public SSE (`event: snapshot`). Data is the same redacted public projection. Connections are capped per match and removed on close; 15-second comments keep intermediaries from idling a live connection. No bearer is accepted or needed.

### `GET /api/matches/:id/replay`

Raw JSON download, available only after the entire series is completed or aborted; active access is 409. Contains rules/config (including both layouts), canonical turns/actions/events, abort reason if any, outcome, complete final snapshot, and SHA-256. It never contains seat/host tokens or raw coaching notes.

### `POST /api/matches/:id/rematch`

Requires host bearer. Body `{ "config": MatchConfig }`. Returns a new id and new tokens. It never mutates the old match or replay.

### `POST /api/replays/verify`

Body is a replay (maximum 512 KiB). Recomputes schema, legality, each transition/event, terminal outcome, final state, and SHA-256. Failure is 400; a self-reported hash alone is never trusted.

## CLI

```text
serve [--host HOST] [--port N] [--turn-timeout-ms N]
rules
create --url URL --config FILE
observe --url URL --match ID --token-env NAME
act --url URL --match ID --leg N --turn N --action JSON --request-id ID --token-env NAME
replay --url URL --match ID [--out FILE]
verify FILE
demo [--out FILE]
```

Add `--json` for one JSON envelope on stdout. Tokens are read from the **named environment variable**, never accepted as a CLI token value. Exit codes:

- 0 success
- 2 usage/argument/missing-token error
- 3 transport/server failure
- 5 contract/replay/API rejection

`serve --host 0.0.0.0` prints an explicit trusted-LAN warning. Reserved routes `/run`, `/events`, `/health`, `/interrupt`, and `/keepalive` are intentionally unused.
