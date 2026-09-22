# Usage

## Browser practice

```sh
npm ci
npm run build
node dist/src/cli.js serve
```

Open `http://127.0.0.1:3210`.

1. Select **Open lanes**, **Maximum legal budget**, or edit each core/lock/trap layout. The combined budget is shown for each seat.
2. Set each controller to **Scripted practice** or **Manual / external**.
3. Raider selectors tune only that seat while raiding (`direct` or `cautious`); sentinel selectors tune only while defending (`patrol` or `pursuit`). These are deterministic scripted styles, not models.
4. Add an optional private coaching note (maximum 1000 characters). Built-ins do not parse this text; changing it alone does not change their behavior.
5. Start the series. Scripted/scripted finishes deterministically; an external seat gets authenticated legal-action buttons.
6. Read the map, public revelations, roles, leg/beat, HP, tools, core possession, and completed legs.
7. Once terminal, inspect/step/download the replay. Change setup and rematch; the old replay remains unchanged.

A replay may disclose both layouts, so share it only after accepting that terminal disclosure.

## Deterministic local demo

```sh
node dist/src/cli.js demo --json
node dist/src/cli.js demo --out /tmp/clank-vault-replay.json
node dist/src/cli.js verify /tmp/clank-vault-replay.json --json
```

The demo is labeled `scripted`; it performs no external inference/provider call. `externalUsage` is null because external usage was not measured, not asserted to be zero.

## Two external seats over CLI

Start the server and create a match:

```sh
node dist/src/cli.js serve
node dist/src/cli.js create \
  --url http://127.0.0.1:3210 \
  --config examples/external-match.json \
  --json
```

The create output contains the match ID, host capability, and separate A/B capabilities. In separate trusted shells, put each seat value in an environment variable:

```sh
export CLANK_A_TOKEN='returned A value'
export CLANK_B_TOKEN='returned B value'
```

Seat A loop:

```sh
node dist/src/cli.js observe --url http://127.0.0.1:3210 \
  --match MATCH_ID --token-env CLANK_A_TOKEN --json

node dist/src/cli.js act --url http://127.0.0.1:3210 \
  --match MATCH_ID --leg 1 --turn 1 \
  --action '{"type":"move","target":1}' \
  --request-id A-1 --token-env CLANK_A_TOKEN --json
```

Seat B does the same with `CLANK_B_TOKEN`. Always copy `leg`, `turn`, and one entry from `legalActions` in the newest observation. Reuse the same request ID only for an identical retry. A successful first submission waits invisibly; neither player gains a timing advantage.

After terminal state:

```sh
node dist/src/cli.js replay --url http://127.0.0.1:3210 \
  --match MATCH_ID --out replay.json
node dist/src/cli.js verify replay.json
```

## Game-only external agent loop

A shell-capable game agent such as pi can be instructed to operate only these game commands:

1. Run `observe --json` with a preselected token environment-variable name.
2. Read only the returned observation/coaching/legal actions.
3. Select exactly one listed action.
4. Run `act --json` with the same leg/turn and a new request ID.
5. If waiting, wait for the other seat; otherwise repeat until terminal.
6. Never inspect server memory, browser storage, another seat's environment, or filesystem secrets.

No provider-specific adapter is included. Protocol tests certify this repository's interface, **not** pi or any third-party product. A Ciani external-seat smoke is recorded in `external-agent-smoke.md`; other model/harness integrations remain manual tests.

## Mixed and external/external browser flow

Select one or both seats as **Manual / external**. The browser keeps returned capabilities in the current page's JavaScript memory, never a URL. Choose the active external seat tab and click a listed action. With two external seats, the page switches to the other seat after the first sealed submission. This convenience mode is appropriate for same-machine practice, not adversarial shared-browser play.

## LAN

```sh
node dist/src/cli.js serve --host 0.0.0.0 --port 3210
```

Use the machine's trusted-LAN address from another device. Do not forward the port to the Internet. Two-machine LAN behavior is documented but not claimed by automated same-machine tests; see `TESTING.md`.
