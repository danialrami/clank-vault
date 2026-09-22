# Clank Vault — LAN-first v1 specification

## Goal and smallest loop
Design a tiny data fortress, guide an agent raid, inspect where a trap or counter-move mattered, swap roles, and rematch. This is an abstract board game, NOT real pentesting. No VMs, exploit code, real credentials, or tool execution.

## Exact graph and layout, rulesVersion vault-1
Nodes 0 Entry, 1 North, 2 South, 3 Hub, 4 Vault. Undirected edges (0,1),(0,2),(1,3),(2,3),(3,4). Graph is fixed and always public. Each seat supplies a fortress used when that seat defends: {core:3|4, locks:number[], traps:number[]}. lock/trap entries are unique integers 1..4; arrays length total <=4; a lock and trap may share a node and cost two points. No player edits the graph or adds an entry-node defense. Core location and unobserved defenses are private. Layout validator proves budget/shape and at least one entry-to-core route under the published resource model; include a fixture for maximal legal defenses.

## Paired raid structure
Leg 1: A raids B's fortress; B controls a sentinel. Leg 2: B raids A's fortress; A controls a sentinel. Each leg resets all raid resources/defenses. Raider starts at 0, HP 6, tools 4 (cap 4), no core. Sentinel starts at 3. At most 12 simultaneous beats per leg. Roles change only after the leg completes, never on an HTTP client's claim.

## Actions and resolution
Raider actions:
- move {type:'move',target:node}: an adjacent node; if its lock remains, the move stays put, consumes the beat, and reveals that lock. Passing a lock is impossible without breaching it.
- breach {type:'breach',target:node}: adjacent node, costs 1 tool; removes its lock if present, reveals its lock state; a miss still costs the tool and beat.
- scan {type:'scan',target:node}: current or adjacent node, costs 1 tool; reveals trap, lock and whether core is there.
- rest {type:'rest'}: gains 1 tool up to 4.
- take {type:'take'}: if standing at the core and not already carrying it, take it; otherwise consumes beat with an explicit no-op event.
- extract {type:'extract'}: succeeds only at Entry while carrying core and still alive after hazards; otherwise consumes beat with an explicit no-op.
Sentinel actions: move to an adjacent node, or wait {type:'wait'}.

Both actions are committed from the start-of-beat view. Resolve raider action and sentinel movement, then a newly-entered live trap deals 2 HP once and becomes spent/revealed, then co-location with sentinel deals 1 HP. Node entry reveals that node's defense/core status. An extract completes only if its conditions hold after hazards. HP floors at zero. A dead raider or turn-12 non-extraction fails the raid. Sentinels cannot create defenses mid-raid. No damage to sentinel; no fake OS security mechanics.

## Views and outcomes
Raider sees the public graph, its resources/core possession, visited/scanned node facts, and sentinel location only when current or adjacent; otherwise sentinel is null/unknown. Defender sees its own complete fortress and current raider/sentinel positions and resources, but no opponent private note or pending action. Public spectator sees raid progress and revealed nodes only, never private layouts while a series is active. Full replay and both layouts are available only after the ENTIRE two-leg series completes.

Compare the two raid records: exactly one extraction => that raiding seat wins. Both extract => fewer used beats wins; equal beats => greater HP remaining wins; equal again => draw. Both fail => draw (do not invent progress points). Global abort => no winner, not a completed tactical draw. The public view carries completed leg results and current roles.

## Practice and minimal UI
Scripted raider/sentinel policies are role-aware, including at least cautious versus direct raiders and patrol versus pursuit sentinels. Selectors describe which role they tune. The board labels all five nodes, unknown information, locked/revealed/spent defenses, roles, tools, HP, leg/beat and extraction outcome. Support bot/bot demo, manual/bot, and external/external. Expose a small validated layout editor or preset selector and show budget usage. Rematch creates new state; old logs stay immutable.

## Non-goals and design caveats
No real exploitation. No claim a reachable layout is perfectly balanced. Host is trusted and creates initial configurations; competitive hidden-authoring/matchmaking is out of scope. Two-client hidden-view tests verify API projection, not a malicious-host threat model. No public-ranked fairness or arbitrary uploaded agents.

## Authorization and scope
Daniel authorized the specification and subsequent v1 build on 2026-09-21. This contract is written before implementation. Deliver an actual local game, not a generated mockup. Same-machine automated tests and two-machine LAN/model-backed checks are separate facts. Never claim fun, balanced ranked play, or compatibility with an untested harness.

## Platform
Node 24 LTS, TypeScript strict, Fastify, plain browser HTML/CSS/JavaScript. Keep the independent repo self-contained; no sibling-game imports or universal arena framework. Pin package versions and commit package-lock.json. Node's test runner is sufficient; use Playwright for browser E2E. Known available package versions: fastify 5.12.5, typescript 7.0.2, @types/node 24.10.1, playwright 1.63.0. A Linux headless Chromium package, @sparticuz/chromium 153.0.0, is available for the sandbox. Public/personal repos have no assumed access to the private lufs runner fleet.

## Interface and authority
One referee module owns the transition logic; UI, CLI, and HTTP are readers/adapters. Export createInitialState(config), legalActions(state, seat), observe(state, seat), resolveTurn(state, actions), publicView(state), and verifyReplay(replay) with explicit TypeScript types. Unit 01 defines the complete canonical types in src/engine.ts; later units import them rather than duplicate them. A Seat is 'A' | 'B'; actions are submitted once per numbered turn for the current leg. Incoming runtime values must be validated even if TypeScript compiles.

The HTTP surface has these routes:
- GET /api/status — game/version and honest process status.
- GET /api/rules — machine-readable rules and action grammar.
- POST /api/matches — validated configuration, returns id, hostToken, tokens {A,B}, and public view. Anyone on the trusted LAN may create a match, subject to a small in-memory match cap; this is not a public hosting boundary.
- GET /api/matches/:id — public redacted view, no pending move values or private coaching.
- GET /api/matches/:id/observe — Authorization: Bearer seat token; returns that seat's role, observation, legal actions, bounded coaching note and match identifiers.
- POST /api/matches/:id/actions — same bearer; body {leg,turn,action,requestId}; a successful identical retry is idempotent; a conflicting duplicate, stale turn, wrong leg or unknown field/action is rejected without advancing state. Resolve only when both seats have an action, except a documented server-owned bot seat.
- GET /api/matches/:id/stream — public redacted server-sent snapshots, no secrets in event data. Bounded connections and clean close.
- GET /api/matches/:id/replay — only when terminal; earlier returns 409. Export includes rulesVersion/config/actions/events/result but no seat/host tokens, API keys, or raw private coaching notes. Hashes of tactics may be included.
- POST /api/matches/:id/rematch — host bearer; validated replacement configuration creates a new id/tokens, never mutates the old replay.

Each HTTP response except SSE/static/replay downloads uses {status:'success',data:...} or {status:'error',code:number,message:string}. Return appropriate HTTP codes (400 invalid, 401 no/invalid bearer, 404 unknown, 409 conflict, 413 oversized, 429 cap). Do not leak rejected private values in public logs. Referee errors are not wins. No arbitrary JS execution or uploaded plugins. Same-origin browser calls; reject foreign Origin on mutation routes, JSON-only bodies, bounded request size (e.g. 16KB), safe textContent rendering, no secrets in URLs, no unbounded agent loops. Local memory is explicitly ephemeral; export completed replays to retain them.

The CLI must support serve, rules, create, observe, act, replay, verify, and demo with --json machine output; tokens read from a named env var, not required as a command-line argument. Exit floor 0 success, 2 usage, 5 contract violation; additional transport exit code 3 is documented. bind defaults 127.0.0.1; --host 0.0.0.0 requires an explicit LAN warning. Do not use reserved paths /run, /events, /health, /interrupt, or /keepalive as routes.

## Entrants and coaching
Provide closed, deterministic built-in practice styles and an external seat. No paid API key needed for practice. No hidden provider calls. Coaching notes (<=1000 characters per seat) are passed in authenticated observations for the external agent to consume; changing text alone must not be advertised as changing the built-in policy. Label built-ins as scripted styles, not LLMs. Document how pi or another shell-capable game-only agent can use the actual CLI/HTTP API; generic protocol tests do not certify those third-party products. No provider-specific/MCP adapter is required in v1; this narrowing from the research proposal is explicit, reversible, and avoids pretending untested integrations work. External compute/usage is unverified/null, not zero. Demo mode is labeled scripted. A future metered same-model class is not implemented or claimed.

## Timing and replay
No faster-submission advantage. Both actions seal against the same start state; no opponent pending-action preview. A configurable turn deadline (default 60s, test clock injectable) must not hang forever. On deadline the match ABORTS with a named timeout and no winner; provider/transport failures are not tactical victories. The server reports active, completed, or aborted honestly. Replay verifies schema, legal action sequence, exact transitions, outcome, and hash where present by recomputing from the canonical engine. Tampering and missing final state fail closed; a self-reported hash is not sufficient proof. No timestamps affect deterministic game results.

## Required deliverables
README quickstart and LAN instructions; CHANGELOG with actual v1 changes; AGENTS.md; docs/usage.md, docs/rules.md, docs/protocol.md, docs/security.md; TESTING.md with exact commands, real outputs/limitations; .agents/skills/play-clank-vault/SKILL.md and .agents/skills/verify-clank-vault/SKILL.md with frontmatter name+description, project-specific steps, failure checks, and pointers rather than copied global skill docs. Root SPEC.md is a pointer to this phase. Include a frozen lockfile and node pin. License remains UNLICENSED pending owner's explicit choice; do not invent a copyright grant.

CI is authored in ci/verify.yml, not .github/workflows, since integration workflow scope is unavailable. It is a staged template, NOT active CI. Use SHA-pinned actions (checkout v5 fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09; setup-node v5 a0853c24544627f65ddf259abe73b1d18a591444). Public repo uses ubuntu-latest as an explicitly documented personal-repo exception, not private self-hosted fleet. Document placement needed; do not claim checks ran just because a PR is clean with no checks. No artifact upload needed. Exact npm verify must run build/typecheck, unit/API tests and deterministic replay checks; browser E2E is separate npm run test:e2e or incorporated when feasible, and missing browser fails honestly rather than skips green.

## Verification and acceptance
A fresh npm ci and npm run verify must pass. Tests include every move/rule branch, illegal/oversized/config inputs, resource/terminal invariants, side-swap or role-swap relations, submission-order equivalence, hidden/pending-info nonleakage, idempotency, timeout, full two-client HTTP game, complete replay and tamper rejection. Browser E2E creates and completes a practice game, observes visible result, inspects/exports replay, changes a style/note and rematches. Test logs belong in a compact verification report, not raw token-bearing HTTP dumps. No real-model or physical LAN claims without actually running those tests.

## Ecosystem references
Research rationale (private KB; not required to run): https://github.com/lufs-audio/kb/pull/261 (research suite pending CI; no runtime dependency) . House conventions: bplate docs/units/08-documentation-and-workflow-standard.md and 10-exit-code-and-json-envelope-standard.md. Global speccing/land-plane skills live in danialrami/dotfiles; do not vendor them. This is a standalone game, not a Workchain component or lsbx consumer.

## V1 review clarification — 2026-09-22
The optional POST /api/replays/verify utility accepts 512 KiB, separately bounded from 16 KiB game mutations. A real 13-turn exported replay was 17,876 compact JSON bytes and exposed the original shared-limit bug. This is a utility-route limit correction, not a game-rule change.
