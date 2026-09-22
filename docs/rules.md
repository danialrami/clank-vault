# Rules — `vault-1`

Clank Vault is an abstract board game. “Locks,” “traps,” “breach,” and “scan” are board state only.

## Board and fortress

The graph is fixed and public:

- 0 Entry
- 1 North
- 2 South
- 3 Hub
- 4 Vault
- undirected edges: 0–1, 0–2, 1–3, 2–3, 3–4

Each seat privately chooses the fortress used while that seat defends:

```json
{ "core": 3, "locks": [1], "traps": [2] }
```

The core is at node 3 or 4. Lock/trap entries are unique within their array and are nodes 1–4. Locks plus traps cost at most four points total; a lock and trap may share a node and cost two points. The layout must leave at least one survivable Entry-to-core route under the published HP/tool/beat model. The host is trusted to create both layouts; competitive hidden authoring is outside v1.

## Series and resources

- Leg 1: A raids B; B controls the sentinel.
- Leg 2: B raids A; A controls the sentinel.
- Roles swap only after leg 1 actually completes.
- Each leg resets defenses and resources.
- Raider: starts at Entry, 6 HP, 4 tools (cap 4), no core.
- Sentinel: starts at Hub.
- Maximum: 12 simultaneous beats per leg.

## Actions

Raider:

- `move target`: target must be adjacent. A live lock blocks entry, consumes the beat, and is revealed.
- `breach target`: adjacent; costs one tool. Removes/reveals a live lock. A miss still costs the tool and beat.
- `scan target`: current or adjacent; costs one tool. Reveals lock, trap, and core fact.
- `rest`: gains one tool up to 4.
- `take`: takes the core only when standing on it without already carrying it; otherwise explicit no-op.
- `extract`: requests extraction only at Entry while carrying the core; otherwise explicit no-op.

Sentinel:

- `move target`: adjacent.
- `wait`.

## Simultaneous resolution

Both actions commit from the same start-of-beat view. Resolution order is exact:

1. Resolve the raider action.
2. Resolve sentinel movement/wait.
3. A newly entered live trap deals 2 HP once, becomes spent, and is revealed.
4. Final co-location with the sentinel deals 1 HP.
5. Resolve requested extraction, death, then beat-12 limit.

HP floors at zero. Sentinel crossing without final co-location does not deal damage. Traps fire on successful node entry, not on a blocked move, scan, breach, wait, or remaining on a node. Extraction succeeds only if conditions still hold and HP is above zero after hazards.

## Information

Raider sees its position, HP, tools, core possession, visited/scanned/revealed facts, and the sentinel only when current or adjacent. Defender sees its complete active fortress plus both positions and raider HP/tools/core possession. Public spectators see public resources/progress, completed leg records, and revealed facts only. Pending action values and private coaching are never visible to the opponent/public.

Both layouts and the full replay unlock only when the **entire two-leg series** is completed or globally aborted.

## Outcome

Compare the two raid records:

1. Exactly one extracts: that raiding seat wins.
2. Both extract: fewer used beats wins.
3. Equal beats: greater HP remaining wins.
4. Still equal: draw.
5. Both fail: draw; no progress points.

A global timeout, server/referee failure, or shutdown is an **abort with no winner**, not a tactical draw or win.
