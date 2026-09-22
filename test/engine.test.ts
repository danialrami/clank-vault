import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chooseAction } from '../src/bots.js';
import {
  ContractError,
  MAX_BEATS,
  SEATS,
  abortGame,
  createInitialState,
  exportReplay,
  legalActions,
  observe,
  publicView,
  resolveTurn,
  validateAction,
  validateLayout,
  validateMatchConfig,
  verifyReplay,
  type Action,
  type GameState,
  type MatchConfig,
  type Seat,
} from '../src/engine.js';

function baseConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    name: 'Engine test',
    layouts: {
      A: { core: 3, locks: [], traps: [] },
      B: { core: 3, locks: [], traps: [] },
    },
    entrants: { A: 'external', B: 'external' },
    styles: {
      A: { raider: 'direct', sentinel: 'patrol' },
      B: { raider: 'direct', sentinel: 'patrol' },
    },
    ...overrides,
  };
}

function actions(state: GameState, raider: Action, sentinel: Action): Record<Seat, Action> {
  return {
    [state.current.raiderSeat]: raider,
    [state.current.defenderSeat]: sentinel,
  } as Record<Seat, Action>;
}

function resolve(state: GameState, raider: Action, sentinel: Action): GameState {
  return resolveTurn(state, actions(state, raider, sentinel)).state;
}

function terminalScripted(config = baseConfig({ entrants: { A: 'scripted', B: 'scripted' } })): GameState {
  let state = createInitialState(config);
  let guard = 0;
  while (state.phase === 'active' && guard < 24) {
    guard += 1;
    const selected = {} as Record<Seat, Action>;
    for (const seat of SEATS) {
      const view = observe(state, seat);
      const style = view.role === 'raider' ? state.config.styles[seat].raider : state.config.styles[seat].sentinel;
      selected[seat] = chooseAction(view, style);
    }
    state = resolveTurn(state, selected).state;
  }
  assert.notEqual(state.phase, 'active');
  return state;
}

function extractLeg(state: GameState, turn: number, hp: number): GameState {
  state = structuredClone(state);
  state.current.turn = turn;
  state.current.hp = hp;
  state.current.raiderPosition = 0;
  state.current.sentinelPosition = 3;
  state.current.carryingCore = true;
  return resolve(state, { type: 'extract' }, { type: 'wait' });
}

function failLeg(state: GameState): GameState {
  state = structuredClone(state);
  state.current.turn = MAX_BEATS;
  state.current.raiderPosition = 0;
  state.current.sentinelPosition = 3;
  return resolve(state, { type: 'rest' }, { type: 'wait' });
}

test('layout/config validators accept maximum fixture and reject malformed, over-budget, and unsurvivable layouts', async () => {
  const fixture = JSON.parse(await readFile(`${process.cwd()}/fixtures/maximal-layout.json`, 'utf8')) as unknown;
  assert.deepEqual(validateLayout(fixture), { core: 4, locks: [1, 3], traps: [2, 4] });
  assert.throws(() => validateLayout({ core: 4, locks: [1, 2, 3], traps: [1, 4] }), /budget/u);
  assert.throws(() => validateLayout({ core: 4, locks: [], traps: [1, 2, 3, 4] }), /survivable/u);
  assert.throws(() => validateLayout({ core: 3, locks: [0], traps: [] }), /Entry/u);
  assert.throws(() => validateLayout({ core: 3, locks: [1, 1], traps: [] }), /unique/u);
  assert.throws(() => validateLayout({ core: 2, locks: [], traps: [] }), /core/u);
  assert.throws(() => validateMatchConfig({ layouts: baseConfig().layouts, extra: true }), /unknown field/u);
  assert.throws(() => validateMatchConfig({ layouts: baseConfig().layouts, coaching: { A: 'x'.repeat(1001) } }), /1000/u);
});

test('runtime validation rejects accessors, exotic prototypes, unknown action fields, and wrong action shapes', () => {
  const accessor = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(accessor, 'core', { get: () => 3, enumerable: true });
  accessor.locks = [];
  accessor.traps = [];
  assert.throws(() => validateLayout(accessor), /data property/u);
  assert.throws(() => validateLayout(Object.assign(Object.create({}), { core: 3, locks: [], traps: [] })), /plain object/u);
  assert.throws(() => validateAction({ type: 'rest', target: 1 }), /unknown field/u);
  assert.throws(() => validateAction({ type: 'move', target: 9 }), /0\.\.4/u);
  assert.throws(() => validateAction({ type: 'pwn' }), /invalid/u);
  const sparse = new Array<unknown>(1);
  assert.throws(() => validateLayout({ core: 3, locks: sparse, traps: [] }), /sparse/u);
  const nestedAccessor = { type: 'move', target: 1 };
  Object.defineProperty(nestedAccessor, 'target', { get: () => 1, enumerable: true });
  assert.throws(() => validateAction(nestedAccessor), /data property/u);
});

test('legal actions are role-specific and bounded by tools and adjacency', () => {
  const state = createInitialState(baseConfig());
  const raider = legalActions(state, 'A');
  const sentinel = legalActions(state, 'B');
  assert(raider.some((action) => action.type === 'scan'));
  assert(raider.some((action) => action.type === 'extract'));
  assert.deepEqual(sentinel, [{ type: 'move', target: 1 }, { type: 'move', target: 2 }, { type: 'move', target: 4 }, { type: 'wait' }]);
  const depleted = structuredClone(state);
  depleted.current.tools = 0;
  assert(!legalActions(depleted, 'A').some((action) => action.type === 'scan' || action.type === 'breach'));
  assert.throws(() => resolveTurn(state, { A: { type: 'move', target: 4 }, B: { type: 'wait' } }), /illegal/u);
});

test('lock block, breach hit, entry, node reveal, and spent trap resolve exactly', () => {
  let state = createInitialState(baseConfig({ layouts: { A: { core: 3, locks: [], traps: [] }, B: { core: 3, locks: [1], traps: [1] } } }));
  let resolved = resolveTurn(state, actions(state, { type: 'move', target: 1 }, { type: 'wait' }));
  assert.equal(resolved.state.current.raiderPosition, 0);
  assert.equal(resolved.state.current.turn, 2);
  assert(resolved.events.some((item) => item.kind === 'lock-blocked'));
  assert.equal(resolved.state.current.knowledge[1].lock, 'live');
  state = resolved.state;
  resolved = resolveTurn(state, actions(state, { type: 'breach', target: 1 }, { type: 'wait' }));
  assert.equal(resolved.state.current.tools, 3);
  assert(resolved.events.some((item) => item.kind === 'breach-hit'));
  state = resolved.state;
  resolved = resolveTurn(state, actions(state, { type: 'move', target: 1 }, { type: 'move', target: 2 }));
  assert.equal(resolved.state.current.hp, 4);
  assert.equal(resolved.state.current.knowledge[1].trap, 'spent');
  assert(resolved.events.some((item) => item.kind === 'trap'));
  state = resolve(resolved.state, { type: 'move', target: 0 }, { type: 'move', target: 0 });
  const hp = state.current.hp;
  state = resolve(state, { type: 'move', target: 1 }, { type: 'move', target: 1 });
  assert.equal(state.current.hp, Math.max(0, hp - 1), 'spent trap does not fire again; collision still does');
});

test('breach miss, scan, rest cap, take/extract no-op, sentinel movement/wait and collision branches emit explicit events', () => {
  let state = createInitialState(baseConfig());
  let result = resolveTurn(state, actions(state, { type: 'breach', target: 1 }, { type: 'wait' }));
  assert.deepEqual(result.events.map((item) => item.kind), ['breach-miss', 'sentinel-wait']);
  state = result.state;
  result = resolveTurn(state, actions(state, { type: 'scan', target: 2 }, { type: 'move', target: 1 }));
  assert(result.events.some((item) => item.kind === 'scan'));
  assert.equal(result.state.current.knowledge[2].scanned, true);
  state = result.state;
  const tools = state.current.tools;
  result = resolveTurn(state, actions(state, { type: 'rest' }, { type: 'move', target: 0 }));
  assert.equal(result.state.current.tools, Math.min(4, tools + 1));
  assert(result.events.some((item) => item.kind === 'collision'));
  state = result.state;
  result = resolveTurn(state, actions(state, { type: 'take' }, { type: 'wait' }));
  assert(result.events.some((item) => item.kind === 'take-noop'));
  state = result.state;
  result = resolveTurn(state, actions(state, { type: 'extract' }, { type: 'wait' }));
  assert(result.events.some((item) => item.kind === 'extract-noop'));
});

test('core can be taken only at its node, and carrying state survives return', () => {
  let state = createInitialState(baseConfig());
  state = resolve(state, { type: 'move', target: 1 }, { type: 'move', target: 1 });
  state = resolve(state, { type: 'move', target: 3 }, { type: 'move', target: 3 });
  assert.equal(state.current.knowledge[3].core, true);
  const taken = resolveTurn(state, actions(state, { type: 'take' }, { type: 'wait' }));
  assert.equal(taken.state.current.carryingCore, true);
  assert(taken.events.some((item) => item.kind === 'take'));
  state = resolve(taken.state, { type: 'move', target: 1 }, { type: 'move', target: 1 });
  state = resolve(state, { type: 'move', target: 0 }, { type: 'move', target: 0 });
  assert.equal(state.current.carryingCore, true);
});

test('hazards resolve before extraction and HP floors at zero', () => {
  let state = createInitialState(baseConfig());
  state = structuredClone(state);
  state.current.raiderPosition = 0;
  state.current.sentinelPosition = 1;
  state.current.carryingCore = true;
  state.current.hp = 1;
  const result = resolveTurn(state, actions(state, { type: 'extract' }, { type: 'move', target: 0 }));
  assert.equal(result.state.completedLegs[0]?.reason, 'dead');
  assert.equal(result.state.completedLegs[0]?.hpRemaining, 0);
  assert(!result.events.some((item) => item.kind === 'extracted'));
});

test('turn 12 fails the raid, role swap resets resources and defenses, and roles never come from callers', () => {
  let state = createInitialState(baseConfig({ layouts: { A: { core: 4, locks: [1], traps: [2] }, B: { core: 3, locks: [2], traps: [1] } } }));
  state = structuredClone(state);
  state.current.turn = 12;
  state.current.hp = 2;
  state.current.tools = 0;
  state.current.liveLocks = [];
  state = resolve(state, { type: 'rest' }, { type: 'wait' });
  assert.equal(state.current.leg, 2);
  assert.equal(state.current.raiderSeat, 'B');
  assert.equal(state.current.defenderSeat, 'A');
  assert.equal(state.current.turn, 1);
  assert.equal(state.current.hp, 6);
  assert.equal(state.current.tools, 4);
  assert.deepEqual(state.current.liveLocks, [1]);
  assert.equal(state.completedLegs[0]?.reason, 'turn-limit');
});

test('exact series scoring covers one extraction, fewer beats, greater HP, equal draw, and both-fail draw', () => {
  let state = createInitialState(baseConfig());
  state = extractLeg(state, 5, 4);
  state = failLeg(state);
  assert.deepEqual(state.result, { status: 'completed', winner: 'A', reason: 'one-extraction' });

  state = createInitialState(baseConfig());
  state = extractLeg(state, 5, 3);
  state = extractLeg(state, 6, 6);
  assert.deepEqual(state.result, { status: 'completed', winner: 'A', reason: 'fewer-beats' });

  state = createInitialState(baseConfig());
  state = extractLeg(state, 5, 2);
  state = extractLeg(state, 5, 4);
  assert.deepEqual(state.result, { status: 'completed', winner: 'B', reason: 'greater-hp' });

  state = createInitialState(baseConfig());
  state = extractLeg(state, 5, 4);
  state = extractLeg(state, 5, 4);
  assert.deepEqual(state.result, { status: 'completed', winner: null, reason: 'draw-equal' });

  state = createInitialState(baseConfig());
  state = failLeg(state);
  state = failLeg(state);
  assert.deepEqual(state.result, { status: 'completed', winner: null, reason: 'draw-both-failed' });
});

test('observation and public projections hide active layouts, private notes, and distant sentinel', () => {
  const state = createInitialState(baseConfig({ coaching: { A: 'PRIVATE_A', B: 'PRIVATE_B' }, layouts: { A: { core: 4, locks: [1], traps: [4] }, B: { core: 3, locks: [2], traps: [3] } } }));
  const raider = observe(state, 'A');
  const defender = observe(state, 'B');
  const publicState = publicView(state);
  assert.equal(raider.activeFortress, null);
  assert.equal(raider.opponent.position, null);
  assert.deepEqual(defender.activeFortress, state.config.layouts.B);
  assert.deepEqual(defender.opponent, { position: 0, hp: 6, tools: 4, carryingCore: false });
  assert.equal(publicState.layouts, null);
  const serialized = JSON.stringify(publicState);
  assert(!serialized.includes('PRIVATE_A'));
  assert(!serialized.includes('PRIVATE_B'));
  assert(!serialized.includes('"core":3'));
});

test('submission record property order does not change a transition', () => {
  const state = createInitialState(baseConfig());
  const normal = resolveTurn(state, { A: { type: 'move', target: 1 }, B: { type: 'move', target: 1 } });
  const reversed = resolveTurn(state, { B: { type: 'move', target: 1 }, A: { type: 'move', target: 1 } });
  assert.deepEqual(normal, reversed);
});

test('scripted policies are deterministic, role-aware, legal, and can complete an extraction demo without external use', () => {
  const state = terminalScripted();
  assert.equal(state.phase, 'completed');
  assert(state.completedLegs.some((leg) => leg.extracted));
  assert.equal(state.history.length <= 24, true);
  const replay = exportReplay(state);
  assert.deepEqual(verifyReplay(replay), { ok: true, errors: [] });
});

test('complete and aborted replay verification recomputes exact transitions and rejects tampering or missing terminal material', () => {
  const completed = terminalScripted();
  const replay = exportReplay(completed);
  assert.equal(verifyReplay(replay).ok, true);

  const tamperedAction = structuredClone(replay);
  const firstActionTurn = tamperedAction.turns[0];
  assert(firstActionTurn);
  firstActionTurn.actions.A = { type: 'rest' };
  assert.equal(verifyReplay(tamperedAction).ok, false);

  const tamperedEvents = structuredClone(replay);
  const firstEvent = tamperedEvents.turns[0]?.events[0];
  assert(firstEvent);
  firstEvent.detail = 'forged';
  assert.equal(verifyReplay(tamperedEvents).ok, false);

  const tamperedResult = structuredClone(replay);
  tamperedResult.result.winner = tamperedResult.result.winner === 'A' ? 'B' : 'A';
  assert.equal(verifyReplay(tamperedResult).ok, false);

  const tamperedState = structuredClone(replay);
  tamperedState.finalState = null;
  assert.equal(verifyReplay(tamperedState).ok, false);

  const tamperedHash = structuredClone(replay);
  tamperedHash.finalStateHash = '0'.repeat(64);
  assert.equal(verifyReplay(tamperedHash).ok, false);

  const missingFinal = structuredClone(replay) as unknown as Record<string, unknown>;
  delete missingFinal.finalState;
  assert.equal(verifyReplay(missingFinal).ok, false);

  const aborted = abortGame(createInitialState(baseConfig()), 'turn-timeout');
  const abortedReplay = exportReplay(aborted);
  assert.equal(abortedReplay.result.winner, null);
  assert.equal(verifyReplay(abortedReplay).ok, true);
});

test('public terminal view discloses both layouts only after the entire series', () => {
  let state = createInitialState(baseConfig());
  state = failLeg(state);
  assert.equal(publicView(state).layouts, null, 'one completed leg is still private');
  state = failLeg(state);
  assert.deepEqual(publicView(state).layouts, state.config.layouts);
});

test('terminal states reject further turns and expose no legal actions', () => {
  const state = terminalScripted();
  assert.deepEqual(legalActions(state, 'A'), []);
  assert.throws(() => resolveTurn(state, { A: { type: 'rest' }, B: { type: 'wait' } }), ContractError);
});
