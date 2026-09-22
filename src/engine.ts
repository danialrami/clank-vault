import { createHash } from 'node:crypto';

export const RULES_VERSION = 'vault-1' as const;
export const MAX_BEATS = 12;
export const STARTING_HP = 6;
export const STARTING_TOOLS = 4;
export const TOOL_CAP = 4;
export const DEFENSE_BUDGET = 4;

export type Seat = 'A' | 'B';
export type NodeId = 0 | 1 | 2 | 3 | 4;
export type Role = 'raider' | 'sentinel';
export type EntrantMode = 'external' | 'scripted';
export type RaiderStyle = 'cautious' | 'direct';
export type SentinelStyle = 'patrol' | 'pursuit';

export const SEATS: readonly Seat[] = ['A', 'B'];
export const NODES: readonly NodeId[] = [0, 1, 2, 3, 4];
export const NODE_NAMES: Readonly<Record<NodeId, string>> = {
  0: 'Entry',
  1: 'North',
  2: 'South',
  3: 'Hub',
  4: 'Vault',
};
export const EDGES: readonly (readonly [NodeId, NodeId])[] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
  [3, 4],
];

export interface FortressLayout {
  core: 3 | 4;
  locks: NodeId[];
  traps: NodeId[];
}

export interface MatchStyles {
  raider: RaiderStyle;
  sentinel: SentinelStyle;
}

export interface MatchConfig {
  name?: string;
  layouts: Record<Seat, FortressLayout>;
  coaching?: Partial<Record<Seat, string>>;
  entrants?: Partial<Record<Seat, EntrantMode>>;
  styles?: Partial<Record<Seat, Partial<MatchStyles>>>;
}

export interface NormalizedMatchConfig {
  name: string;
  layouts: Record<Seat, FortressLayout>;
  coaching: Record<Seat, string>;
  entrants: Record<Seat, EntrantMode>;
  styles: Record<Seat, MatchStyles>;
}

export type RaiderAction =
  | { type: 'move'; target: NodeId }
  | { type: 'breach'; target: NodeId }
  | { type: 'scan'; target: NodeId }
  | { type: 'rest' }
  | { type: 'take' }
  | { type: 'extract' };
export type SentinelAction = { type: 'move'; target: NodeId } | { type: 'wait' };
export type Action = RaiderAction | SentinelAction;

export type LockKnowledge = 'unknown' | 'live' | 'breached' | 'none';
export type TrapKnowledge = 'unknown' | 'live' | 'spent' | 'none';

export interface NodeKnowledge {
  node: NodeId;
  lock: LockKnowledge;
  trap: TrapKnowledge;
  core: boolean | null;
  visited: boolean;
  scanned: boolean;
}

export interface GameEvent {
  leg: 1 | 2;
  turn: number;
  kind:
    | 'raider-move'
    | 'lock-blocked'
    | 'breach-hit'
    | 'breach-miss'
    | 'scan'
    | 'rest'
    | 'take'
    | 'take-noop'
    | 'extract-noop'
    | 'sentinel-move'
    | 'sentinel-wait'
    | 'trap'
    | 'collision'
    | 'extracted'
    | 'raider-dead'
    | 'turn-limit'
    | 'leg-complete'
    | 'role-swap'
    | 'series-complete'
    | 'series-aborted';
  actor: Seat | null;
  node: NodeId | null;
  amount: number | null;
  detail: string;
}

export interface TurnRecord {
  leg: 1 | 2;
  turn: number;
  actions: Record<Seat, Action>;
  events: GameEvent[];
}

export interface RaidRecord {
  leg: 1 | 2;
  raider: Seat;
  defender: Seat;
  extracted: boolean;
  usedBeats: number;
  hpRemaining: number;
  reason: 'extracted' | 'dead' | 'turn-limit';
}

export interface SeriesResult {
  status: 'completed' | 'aborted';
  winner: Seat | null;
  reason:
    | 'one-extraction'
    | 'fewer-beats'
    | 'greater-hp'
    | 'draw-both-failed'
    | 'draw-equal'
    | 'turn-timeout'
    | 'server-error'
    | 'shutdown';
}

export interface LegState {
  leg: 1 | 2;
  turn: number;
  raiderSeat: Seat;
  defenderSeat: Seat;
  raiderPosition: NodeId;
  sentinelPosition: NodeId;
  hp: number;
  tools: number;
  carryingCore: boolean;
  liveLocks: NodeId[];
  liveTraps: NodeId[];
  spentTraps: NodeId[];
  knowledge: Record<NodeId, NodeKnowledge>;
}

export interface GameState {
  rulesVersion: typeof RULES_VERSION;
  phase: 'active' | 'completed' | 'aborted';
  config: NormalizedMatchConfig;
  current: LegState;
  completedLegs: RaidRecord[];
  history: TurnRecord[];
  result: SeriesResult | null;
}

export interface PublicEvent {
  leg: 1 | 2;
  turn: number;
  kind: string;
  detail: string;
  node: NodeId | null;
}

export interface PublicView {
  rulesVersion: typeof RULES_VERSION;
  phase: GameState['phase'];
  name: string;
  graph: { nodes: { id: NodeId; name: string }[]; edges: [NodeId, NodeId][] };
  leg: 1 | 2;
  turn: number;
  roles: Record<Seat, Role>;
  raider: { seat: Seat; position: NodeId; hp: number; tools: number; carryingCore: boolean };
  sentinel: { seat: Seat; position: NodeId | null };
  revealedNodes: NodeKnowledge[];
  completedLegs: RaidRecord[];
  result: SeriesResult | null;
  events: PublicEvent[];
  practice: { entrants: Record<Seat, EntrantMode>; styles: Record<Seat, MatchStyles>; externalUsage: null };
  layouts: Record<Seat, FortressLayout> | null;
}

export interface Observation {
  rulesVersion: typeof RULES_VERSION;
  phase: GameState['phase'];
  seat: Seat;
  role: Role;
  leg: 1 | 2;
  turn: number;
  graph: PublicView['graph'];
  own: {
    position: NodeId;
    hp: number | null;
    tools: number | null;
    carryingCore: boolean | null;
  };
  opponent: { position: NodeId | null; hp: number | null; tools: number | null; carryingCore: boolean | null };
  activeFortress: FortressLayout | null;
  revealedNodes: NodeKnowledge[];
  completedLegs: RaidRecord[];
  result: SeriesResult | null;
  publicEvents: PublicEvent[];
}

export interface ReplayConfig {
  name: string;
  layouts: Record<Seat, FortressLayout>;
  entrants: Record<Seat, EntrantMode>;
  styles: Record<Seat, MatchStyles>;
}

export interface Replay {
  formatVersion: 1;
  rulesVersion: typeof RULES_VERSION;
  config: ReplayConfig;
  turns: TurnRecord[];
  abort: { reason: 'turn-timeout' | 'server-error' | 'shutdown' } | null;
  events: GameEvent[];
  result: SeriesResult;
  finalState: unknown;
  finalStateHash: string;
}

const ADJACENCY: Readonly<Record<NodeId, readonly NodeId[]>> = {
  0: [1, 2],
  1: [0, 3],
  2: [0, 3],
  3: [1, 2, 4],
  4: [3],
};

export class ContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContractError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ContractError(`${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor)) {
      throw new ContractError(`${label}.${key} must be a data property`);
    }
  }
  return value as UnknownRecord;
}

function exactKeys(record: UnknownRecord, allowed: readonly string[], required: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.getOwnPropertyNames(record)) {
    if (!allowedSet.has(key)) throw new ContractError(`${label} has unknown field ${key}`);
  }
  if (Object.getOwnPropertySymbols(record).length > 0) throw new ContractError(`${label} cannot have symbol fields`);
  for (const key of required) {
    if (!Object.hasOwn(record, key)) throw new ContractError(`${label} is missing ${key}`);
  }
}

function own(record: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function assertPlainData(
  value: unknown,
  label: string,
  depth = 0,
  ancestors: Set<object> = new Set<object>(),
  count: { value: number } = { value: 0 },
): void {
  count.value += 1;
  if (count.value > 50_000) throw new ContractError(`${label} is too complex`);
  if (depth > 64) throw new ContractError(`${label} is too deeply nested`);
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ContractError(`${label} must contain finite numbers`);
    return;
  }
  if (typeof value !== 'object') throw new ContractError(`${label} must contain only data values`);
  if (ancestors.has(value)) throw new ContractError(`${label} cannot be cyclic`);
  ancestors.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new ContractError(`${label} must use ordinary arrays`);
    const names = Object.getOwnPropertyNames(value);
    for (const name of names) {
      if (name === 'length') continue;
      if (!/^(0|[1-9][0-9]*)$/u.test(name) || Number(name) >= value.length) {
        throw new ContractError(`${label} has an invalid array field ${name}`);
      }
    }
    if (Object.getOwnPropertySymbols(value).length > 0) throw new ContractError(`${label} cannot have symbol fields`);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined) throw new ContractError(`${label} cannot be sparse`);
      if (!('value' in descriptor)) throw new ContractError(`${label}[${index}] must be a data property`);
      assertPlainData(descriptor.value, `${label}[${index}]`, depth + 1, ancestors, count);
    }
  } else {
    if (prototype !== Object.prototype && prototype !== null) throw new ContractError(`${label} must contain plain objects`);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new ContractError(`${label} cannot have symbol fields`);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!('value' in descriptor)) throw new ContractError(`${label}.${key} must be a data property`);
      assertPlainData(descriptor.value, `${label}.${key}`, depth + 1, ancestors, count);
    }
  }
  ancestors.delete(value);
}

function asSeatRecord(value: unknown, label: string, required = true): UnknownRecord {
  const record = asRecord(value, label);
  exactKeys(record, SEATS, required ? SEATS : [], label);
  return record;
}

function asNode(value: unknown, label: string): NodeId {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value > 4) {
    throw new ContractError(`${label} must be an integer node 0..4`);
  }
  return value as NodeId;
}

function asDefenseNode(value: unknown, label: string): NodeId {
  const node = asNode(value, label);
  if (node === 0) throw new ContractError(`${label} cannot be Entry`);
  return node;
}

function asBoundedString(value: unknown, label: string, max: number, allowEmpty = true): string {
  if (typeof value !== 'string') throw new ContractError(`${label} must be a string`);
  if ((!allowEmpty && value.length === 0) || value.length > max) {
    throw new ContractError(`${label} must be ${allowEmpty ? 'at most' : '1..'} ${max} characters`);
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function uniqueSorted(nodes: NodeId[]): NodeId[] {
  return [...nodes].sort((left, right) => left - right);
}

function pathReachesCore(layout: FortressLayout): boolean {
  const paths: readonly (readonly NodeId[])[] = layout.core === 3
    ? [[0, 1, 3], [0, 2, 3]]
    : [[0, 1, 3, 4], [0, 2, 3, 4]];
  return paths.some((path) => {
    const defended = path.slice(1);
    const trapDamage = defended.filter((node) => layout.traps.includes(node)).length * 2;
    const lockBeats = defended.filter((node) => layout.locks.includes(node)).length;
    const beatsToCore = defended.length + lockBeats;
    return trapDamage < STARTING_HP && beatsToCore <= MAX_BEATS;
  });
}

export function validateLayout(value: unknown, label = 'layout'): FortressLayout {
  assertPlainData(value, label);
  const record = asRecord(value, label);
  exactKeys(record, ['core', 'locks', 'traps'], ['core', 'locks', 'traps'], label);
  const coreValue = own(record, 'core');
  if (coreValue !== 3 && coreValue !== 4) throw new ContractError(`${label}.core must be 3 or 4`);
  const parseArray = (key: 'locks' | 'traps'): NodeId[] => {
    const candidate = own(record, key);
    if (!Array.isArray(candidate)) throw new ContractError(`${label}.${key} must be an array`);
    if (candidate.length > DEFENSE_BUDGET) throw new ContractError(`${label}.${key} is too long`);
    const nodes = candidate.map((node, index) => asDefenseNode(node, `${label}.${key}[${index}]`));
    if (new Set(nodes).size !== nodes.length) throw new ContractError(`${label}.${key} entries must be unique`);
    return uniqueSorted(nodes);
  };
  const layout: FortressLayout = { core: coreValue, locks: parseArray('locks'), traps: parseArray('traps') };
  if (layout.locks.length + layout.traps.length > DEFENSE_BUDGET) {
    throw new ContractError(`${label} exceeds the ${DEFENSE_BUDGET}-point defense budget`);
  }
  if (!pathReachesCore(layout)) throw new ContractError(`${label} has no survivable entry-to-core route`);
  return layout;
}

function parseStyles(value: unknown, label: string, partial: boolean): MatchStyles {
  if (value === undefined && partial) return { raider: 'cautious', sentinel: 'pursuit' };
  const record = asRecord(value, label);
  exactKeys(record, ['raider', 'sentinel'], partial ? [] : ['raider', 'sentinel'], label);
  const raider = own(record, 'raider') ?? 'cautious';
  const sentinel = own(record, 'sentinel') ?? 'pursuit';
  if (raider !== 'cautious' && raider !== 'direct') throw new ContractError(`${label}.raider is invalid`);
  if (sentinel !== 'patrol' && sentinel !== 'pursuit') throw new ContractError(`${label}.sentinel is invalid`);
  return { raider, sentinel };
}

export function validateMatchConfig(value: unknown): NormalizedMatchConfig {
  assertPlainData(value, 'config');
  const record = asRecord(value, 'config');
  exactKeys(record, ['name', 'layouts', 'coaching', 'entrants', 'styles'], ['layouts'], 'config');
  const layoutsRecord = asSeatRecord(own(record, 'layouts'), 'config.layouts');
  const layouts: Record<Seat, FortressLayout> = {
    A: validateLayout(own(layoutsRecord, 'A'), 'config.layouts.A'),
    B: validateLayout(own(layoutsRecord, 'B'), 'config.layouts.B'),
  };
  const coachingValue = own(record, 'coaching');
  const coachingRecord = coachingValue === undefined ? {} : asSeatRecord(coachingValue, 'config.coaching', false);
  const entrantsValue = own(record, 'entrants');
  const entrantsRecord = entrantsValue === undefined ? {} : asSeatRecord(entrantsValue, 'config.entrants', false);
  const stylesValue = own(record, 'styles');
  const stylesRecord = stylesValue === undefined ? {} : asSeatRecord(stylesValue, 'config.styles', false);
  const coaching: Record<Seat, string> = { A: '', B: '' };
  const entrants: Record<Seat, EntrantMode> = { A: 'external', B: 'external' };
  const styles = {} as Record<Seat, MatchStyles>;
  for (const seat of SEATS) {
    const note = own(coachingRecord, seat);
    coaching[seat] = note === undefined ? '' : asBoundedString(note, `config.coaching.${seat}`, 1000);
    const entrant = own(entrantsRecord, seat) ?? 'external';
    if (entrant !== 'external' && entrant !== 'scripted') {
      throw new ContractError(`config.entrants.${seat} must be external or scripted`);
    }
    entrants[seat] = entrant;
    styles[seat] = parseStyles(own(stylesRecord, seat), `config.styles.${seat}`, true);
  }
  const nameValue = own(record, 'name');
  const name = nameValue === undefined ? 'Clank Vault match' : asBoundedString(nameValue, 'config.name', 120, false);
  return { name, layouts, coaching, entrants, styles };
}

export function validateAction(value: unknown): Action {
  assertPlainData(value, 'action');
  const record = asRecord(value, 'action');
  const type = own(record, 'type');
  if (type === 'move' || type === 'breach' || type === 'scan') {
    exactKeys(record, ['type', 'target'], ['type', 'target'], 'action');
    return { type, target: asNode(own(record, 'target'), 'action.target') };
  }
  if (type === 'rest' || type === 'take' || type === 'extract' || type === 'wait') {
    exactKeys(record, ['type'], ['type'], 'action');
    return { type } as Action;
  }
  throw new ContractError('action.type is invalid');
}

function emptyKnowledge(): Record<NodeId, NodeKnowledge> {
  const knowledge = {} as Record<NodeId, NodeKnowledge>;
  for (const node of NODES) {
    knowledge[node] = { node, lock: 'unknown', trap: 'unknown', core: null, visited: false, scanned: false };
  }
  knowledge[0] = { node: 0, lock: 'none', trap: 'none', core: false, visited: true, scanned: false };
  return knowledge;
}

function startLeg(config: NormalizedMatchConfig, leg: 1 | 2): LegState {
  const raiderSeat: Seat = leg === 1 ? 'A' : 'B';
  const defenderSeat: Seat = leg === 1 ? 'B' : 'A';
  const layout = config.layouts[defenderSeat];
  return {
    leg,
    turn: 1,
    raiderSeat,
    defenderSeat,
    raiderPosition: 0,
    sentinelPosition: 3,
    hp: STARTING_HP,
    tools: STARTING_TOOLS,
    carryingCore: false,
    liveLocks: clone(layout.locks),
    liveTraps: clone(layout.traps),
    spentTraps: [],
    knowledge: emptyKnowledge(),
  };
}

export function createInitialState(config: MatchConfig): GameState {
  const normalized = validateMatchConfig(config);
  return {
    rulesVersion: RULES_VERSION,
    phase: 'active',
    config: normalized,
    current: startLeg(normalized, 1),
    completedLegs: [],
    history: [],
    result: null,
  };
}

function adjacent(from: NodeId, to: NodeId): boolean {
  return ADJACENCY[from].includes(to);
}

function roles(state: GameState): Record<Seat, Role> {
  return {
    [state.current.raiderSeat]: 'raider',
    [state.current.defenderSeat]: 'sentinel',
  } as Record<Seat, Role>;
}

function actionKey(action: Action): string {
  return action.type === 'move' || action.type === 'breach' || action.type === 'scan'
    ? `${action.type}:${action.target}`
    : action.type;
}

export function legalActions(state: GameState, seat: Seat): Action[] {
  if (seat !== 'A' && seat !== 'B') throw new ContractError('seat must be A or B');
  if (state.phase !== 'active') return [];
  const current = state.current;
  if (seat === current.raiderSeat) {
    const actions: Action[] = [];
    for (const target of ADJACENCY[current.raiderPosition]) actions.push({ type: 'move', target });
    if (current.tools > 0) {
      for (const target of ADJACENCY[current.raiderPosition]) actions.push({ type: 'breach', target });
      actions.push({ type: 'scan', target: current.raiderPosition });
      for (const target of ADJACENCY[current.raiderPosition]) actions.push({ type: 'scan', target });
    }
    actions.push({ type: 'rest' }, { type: 'take' }, { type: 'extract' });
    return actions;
  }
  return [...ADJACENCY[current.sentinelPosition].map((target) => ({ type: 'move', target }) as Action), { type: 'wait' }];
}

function revealAll(state: GameState, node: NodeId, scanned: boolean): void {
  const leg = state.current;
  const layout = state.config.layouts[leg.defenderSeat];
  const fact = leg.knowledge[node];
  fact.lock = leg.liveLocks.includes(node) ? 'live' : layout.locks.includes(node) ? 'breached' : 'none';
  fact.trap = leg.liveTraps.includes(node) ? 'live' : leg.spentTraps.includes(node) ? 'spent' : 'none';
  fact.core = layout.core === node;
  fact.visited ||= leg.raiderPosition === node;
  fact.scanned ||= scanned;
}

function revealLock(state: GameState, node: NodeId, value: LockKnowledge): void {
  state.current.knowledge[node].lock = value;
}

function event(state: GameState, kind: GameEvent['kind'], actor: Seat | null, detail: string, node: NodeId | null = null, amount: number | null = null): GameEvent {
  return { leg: state.current.leg, turn: state.current.turn, kind, actor, node, amount, detail };
}

function endResult(first: RaidRecord, second: RaidRecord): SeriesResult {
  if (first.extracted !== second.extracted) {
    return { status: 'completed', winner: first.extracted ? first.raider : second.raider, reason: 'one-extraction' };
  }
  if (!first.extracted) return { status: 'completed', winner: null, reason: 'draw-both-failed' };
  if (first.usedBeats !== second.usedBeats) {
    return { status: 'completed', winner: first.usedBeats < second.usedBeats ? first.raider : second.raider, reason: 'fewer-beats' };
  }
  if (first.hpRemaining !== second.hpRemaining) {
    return { status: 'completed', winner: first.hpRemaining > second.hpRemaining ? first.raider : second.raider, reason: 'greater-hp' };
  }
  return { status: 'completed', winner: null, reason: 'draw-equal' };
}

function ensureActions(value: unknown): Record<Seat, Action> {
  const record = asSeatRecord(value, 'actions');
  return { A: validateAction(own(record, 'A')), B: validateAction(own(record, 'B')) };
}

function actionAllowed(action: Action, allowed: Action[]): boolean {
  const key = actionKey(action);
  return allowed.some((candidate) => actionKey(candidate) === key);
}

export function resolveTurn(stateValue: GameState, actionValue: Record<Seat, Action>): { state: GameState; events: GameEvent[] } {
  if (stateValue.phase !== 'active') throw new ContractError('cannot resolve a terminal game');
  const actions = ensureActions(actionValue);
  for (const seat of SEATS) {
    if (!actionAllowed(actions[seat], legalActions(stateValue, seat))) {
      throw new ContractError(`illegal action for seat ${seat}`);
    }
  }

  const state = clone(stateValue);
  const current = state.current;
  const raiderSeat = current.raiderSeat;
  const defenderSeat = current.defenderSeat;
  const raiderAction = actions[raiderSeat];
  const sentinelAction = actions[defenderSeat];
  const turnEvents: GameEvent[] = [];
  let enteredNode: NodeId | null = null;
  let extractRequested = false;

  switch (raiderAction.type) {
    case 'move': {
      if (current.liveLocks.includes(raiderAction.target)) {
        revealLock(state, raiderAction.target, 'live');
        turnEvents.push(event(state, 'lock-blocked', raiderSeat, `A live lock blocks entry to ${NODE_NAMES[raiderAction.target]}.`, raiderAction.target));
      } else {
        current.raiderPosition = raiderAction.target;
        enteredNode = raiderAction.target;
        revealAll(state, raiderAction.target, false);
        current.knowledge[raiderAction.target].visited = true;
        turnEvents.push(event(state, 'raider-move', raiderSeat, `Raider enters ${NODE_NAMES[raiderAction.target]}.`, raiderAction.target));
      }
      break;
    }
    case 'breach': {
      current.tools -= 1;
      const index = current.liveLocks.indexOf(raiderAction.target);
      if (index >= 0) {
        current.liveLocks.splice(index, 1);
        revealLock(state, raiderAction.target, 'breached');
        turnEvents.push(event(state, 'breach-hit', raiderSeat, `Lock at ${NODE_NAMES[raiderAction.target]} is breached.`, raiderAction.target, 1));
      } else {
        revealLock(state, raiderAction.target, state.config.layouts[defenderSeat].locks.includes(raiderAction.target) ? 'breached' : 'none');
        turnEvents.push(event(state, 'breach-miss', raiderSeat, `Breach at ${NODE_NAMES[raiderAction.target]} finds no live lock.`, raiderAction.target, 1));
      }
      break;
    }
    case 'scan':
      current.tools -= 1;
      revealAll(state, raiderAction.target, true);
      turnEvents.push(event(state, 'scan', raiderSeat, `${NODE_NAMES[raiderAction.target]} is scanned.`, raiderAction.target, 1));
      break;
    case 'rest':
      current.tools = Math.min(TOOL_CAP, current.tools + 1);
      turnEvents.push(event(state, 'rest', raiderSeat, 'Raider rests and restores up to one tool.', current.raiderPosition));
      break;
    case 'take':
      if (current.raiderPosition === state.config.layouts[defenderSeat].core && !current.carryingCore) {
        current.carryingCore = true;
        turnEvents.push(event(state, 'take', raiderSeat, 'Raider takes the core.', current.raiderPosition));
      } else {
        turnEvents.push(event(state, 'take-noop', raiderSeat, 'Take has no effect.', current.raiderPosition));
      }
      break;
    case 'extract':
      extractRequested = current.raiderPosition === 0 && current.carryingCore;
      if (!extractRequested) turnEvents.push(event(state, 'extract-noop', raiderSeat, 'Extract has no effect.', current.raiderPosition));
      break;
    default:
      throw new ContractError('raider supplied a sentinel action');
  }

  if (sentinelAction.type === 'move') {
    current.sentinelPosition = sentinelAction.target;
    turnEvents.push(event(state, 'sentinel-move', defenderSeat, `Sentinel moves to ${NODE_NAMES[sentinelAction.target]}.`, sentinelAction.target));
  } else if (sentinelAction.type === 'wait') {
    turnEvents.push(event(state, 'sentinel-wait', defenderSeat, 'Sentinel waits.', current.sentinelPosition));
  } else {
    throw new ContractError('sentinel supplied a raider action');
  }

  if (enteredNode !== null) {
    const trapIndex = current.liveTraps.indexOf(enteredNode);
    if (trapIndex >= 0) {
      current.liveTraps.splice(trapIndex, 1);
      current.spentTraps.push(enteredNode);
      current.spentTraps = uniqueSorted(current.spentTraps);
      current.hp = Math.max(0, current.hp - 2);
      current.knowledge[enteredNode].trap = 'spent';
      turnEvents.push(event(state, 'trap', defenderSeat, `Trap at ${NODE_NAMES[enteredNode]} deals 2 HP and is spent.`, enteredNode, 2));
    }
  }
  if (current.raiderPosition === current.sentinelPosition) {
    current.hp = Math.max(0, current.hp - 1);
    turnEvents.push(event(state, 'collision', defenderSeat, 'Sentinel co-location deals 1 HP.', current.raiderPosition, 1));
  }

  let raidRecord: RaidRecord | null = null;
  if (extractRequested && current.hp > 0) {
    turnEvents.push(event(state, 'extracted', raiderSeat, 'Raider extracts the core.', 0));
    raidRecord = {
      leg: current.leg,
      raider: raiderSeat,
      defender: defenderSeat,
      extracted: true,
      usedBeats: current.turn,
      hpRemaining: current.hp,
      reason: 'extracted',
    };
  } else if (current.hp === 0) {
    turnEvents.push(event(state, 'raider-dead', raiderSeat, 'Raider HP reaches zero.', current.raiderPosition));
    raidRecord = {
      leg: current.leg,
      raider: raiderSeat,
      defender: defenderSeat,
      extracted: false,
      usedBeats: current.turn,
      hpRemaining: 0,
      reason: 'dead',
    };
  } else if (current.turn === MAX_BEATS) {
    turnEvents.push(event(state, 'turn-limit', null, 'The 12-beat leg limit is reached.', current.raiderPosition));
    raidRecord = {
      leg: current.leg,
      raider: raiderSeat,
      defender: defenderSeat,
      extracted: false,
      usedBeats: current.turn,
      hpRemaining: current.hp,
      reason: 'turn-limit',
    };
  }

  if (raidRecord !== null) {
    state.completedLegs.push(raidRecord);
    turnEvents.push(event(state, 'leg-complete', null, `Leg ${current.leg} completes: ${raidRecord.reason}.`));
    if (current.leg === 1) {
      turnEvents.push(event(state, 'role-swap', null, 'Seats swap raider and sentinel roles.'));
    } else {
      const first = state.completedLegs[0];
      const second = state.completedLegs[1];
      if (first === undefined || second === undefined) throw new ContractError('completed leg invariant failed');
      state.result = endResult(first, second);
      state.phase = 'completed';
      turnEvents.push(event(state, 'series-complete', null, state.result.winner === null ? 'Series completes in a draw.' : `Seat ${state.result.winner} wins the series.`));
    }
  }

  const record: TurnRecord = {
    leg: current.leg,
    turn: current.turn,
    actions: clone(actions),
    events: clone(turnEvents),
  };
  state.history.push(record);

  if (raidRecord !== null && current.leg === 1) {
    state.current = startLeg(state.config, 2);
  } else if (state.phase === 'active') {
    state.current.turn += 1;
  }
  return { state, events: turnEvents };
}

export function abortGame(stateValue: GameState, reason: 'turn-timeout' | 'server-error' | 'shutdown'): GameState {
  if (stateValue.phase !== 'active') return clone(stateValue);
  if (!['turn-timeout', 'server-error', 'shutdown'].includes(reason)) throw new ContractError('invalid abort reason');
  const state = clone(stateValue);
  state.phase = 'aborted';
  state.result = { status: 'aborted', winner: null, reason };
  return state;
}

function graphView(): PublicView['graph'] {
  return {
    nodes: NODES.map((id) => ({ id, name: NODE_NAMES[id] })),
    edges: EDGES.map(([left, right]) => [left, right]),
  };
}

function knownFacts(current: LegState): NodeKnowledge[] {
  return NODES.map((node) => current.knowledge[node])
    .filter((fact) => fact.visited || fact.scanned || fact.lock !== 'unknown' || fact.trap !== 'unknown' || fact.core !== null)
    .map((fact) => clone(fact));
}

function publicEvents(state: GameState): PublicEvent[] {
  const output: PublicEvent[] = [];
  for (const record of state.history) {
    for (const item of record.events) {
      let detail = item.detail;
      let node = item.node;
      if (item.kind === 'sentinel-move' || item.kind === 'sentinel-wait') {
        detail = 'Sentinel committed an action.';
        node = null;
      }
      output.push({ leg: item.leg, turn: item.turn, kind: item.kind, detail, node });
    }
  }
  return output.slice(-100);
}

export function publicView(state: GameState): PublicView {
  const current = state.current;
  const sentinelVisible = current.raiderPosition === current.sentinelPosition || adjacent(current.raiderPosition, current.sentinelPosition);
  return {
    rulesVersion: RULES_VERSION,
    phase: state.phase,
    name: state.config.name,
    graph: graphView(),
    leg: current.leg,
    turn: current.turn,
    roles: roles(state),
    raider: {
      seat: current.raiderSeat,
      position: current.raiderPosition,
      hp: current.hp,
      tools: current.tools,
      carryingCore: current.carryingCore,
    },
    sentinel: { seat: current.defenderSeat, position: sentinelVisible ? current.sentinelPosition : null },
    revealedNodes: knownFacts(current),
    completedLegs: clone(state.completedLegs),
    result: clone(state.result),
    events: publicEvents(state),
    practice: { entrants: clone(state.config.entrants), styles: clone(state.config.styles), externalUsage: null },
    layouts: state.phase === 'active' ? null : clone(state.config.layouts),
  };
}

export function observe(state: GameState, seat: Seat): Observation {
  if (seat !== 'A' && seat !== 'B') throw new ContractError('seat must be A or B');
  const current = state.current;
  const role = seat === current.raiderSeat ? 'raider' : 'sentinel';
  if (role === 'raider') {
    const sentinelVisible = current.raiderPosition === current.sentinelPosition || adjacent(current.raiderPosition, current.sentinelPosition);
    return {
      rulesVersion: RULES_VERSION,
      phase: state.phase,
      seat,
      role,
      leg: current.leg,
      turn: current.turn,
      graph: graphView(),
      own: { position: current.raiderPosition, hp: current.hp, tools: current.tools, carryingCore: current.carryingCore },
      opponent: { position: sentinelVisible ? current.sentinelPosition : null, hp: null, tools: null, carryingCore: null },
      activeFortress: null,
      revealedNodes: knownFacts(current),
      completedLegs: clone(state.completedLegs),
      result: clone(state.result),
      publicEvents: publicEvents(state),
    };
  }
  return {
    rulesVersion: RULES_VERSION,
    phase: state.phase,
    seat,
    role,
    leg: current.leg,
    turn: current.turn,
    graph: graphView(),
    own: { position: current.sentinelPosition, hp: null, tools: null, carryingCore: null },
    opponent: { position: current.raiderPosition, hp: current.hp, tools: current.tools, carryingCore: current.carryingCore },
    activeFortress: clone(state.config.layouts[seat]),
    revealedNodes: knownFacts(current),
    completedLegs: clone(state.completedLegs),
    result: clone(state.result),
    publicEvents: publicEvents(state),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) output[key] = canonicalize(record[key]);
    return output;
  }
  return value;
}

function canonicalString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function replayConfig(state: GameState): ReplayConfig {
  return {
    name: state.config.name,
    layouts: clone(state.config.layouts),
    entrants: clone(state.config.entrants),
    styles: clone(state.config.styles),
  };
}

function replaySnapshot(state: GameState): unknown {
  return {
    rulesVersion: state.rulesVersion,
    phase: state.phase,
    config: replayConfig(state),
    current: clone(state.current),
    completedLegs: clone(state.completedLegs),
    history: clone(state.history),
    result: clone(state.result),
  };
}

export function stateDigest(state: GameState): string {
  return createHash('sha256').update(canonicalString(replaySnapshot(state))).digest('hex');
}

export function exportReplay(state: GameState): Replay {
  if (state.phase === 'active' || state.result === null) throw new ContractError('replay is unavailable until the series is terminal');
  const abort = state.result.status === 'aborted'
    ? { reason: state.result.reason as 'turn-timeout' | 'server-error' | 'shutdown' }
    : null;
  return {
    formatVersion: 1,
    rulesVersion: RULES_VERSION,
    config: replayConfig(state),
    turns: clone(state.history),
    abort,
    events: state.history.flatMap((record) => clone(record.events)),
    result: clone(state.result),
    finalState: replaySnapshot(state),
    finalStateHash: stateDigest(state),
  };
}

function parseReplayConfig(value: unknown): ReplayConfig {
  const record = asRecord(value, 'replay.config');
  exactKeys(record, ['name', 'layouts', 'entrants', 'styles'], ['name', 'layouts', 'entrants', 'styles'], 'replay.config');
  const normalized = validateMatchConfig({
    name: own(record, 'name'),
    layouts: own(record, 'layouts'),
    entrants: own(record, 'entrants'),
    styles: own(record, 'styles'),
  });
  return { name: normalized.name, layouts: normalized.layouts, entrants: normalized.entrants, styles: normalized.styles };
}

function parseTurn(value: unknown, index: number): TurnRecord {
  const label = `replay.turns[${index}]`;
  const record = asRecord(value, label);
  exactKeys(record, ['leg', 'turn', 'actions', 'events'], ['leg', 'turn', 'actions', 'events'], label);
  const leg = own(record, 'leg');
  if (leg !== 1 && leg !== 2) throw new ContractError(`${label}.leg must be 1 or 2`);
  const turn = own(record, 'turn');
  if (!Number.isInteger(turn) || typeof turn !== 'number' || turn < 1 || turn > MAX_BEATS) {
    throw new ContractError(`${label}.turn is invalid`);
  }
  const actions = ensureActions(own(record, 'actions'));
  const events = own(record, 'events');
  if (!Array.isArray(events) || events.length > 20) throw new ContractError(`${label}.events is invalid`);
  return { leg, turn, actions, events: clone(events) as GameEvent[] };
}

function replayError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown replay error';
}

export function verifyReplay(value: unknown): { ok: boolean; errors: string[] } {
  try {
    assertPlainData(value, 'replay');
    const record = asRecord(value, 'replay');
    exactKeys(
      record,
      ['formatVersion', 'rulesVersion', 'config', 'turns', 'abort', 'events', 'result', 'finalState', 'finalStateHash'],
      ['formatVersion', 'rulesVersion', 'config', 'turns', 'abort', 'events', 'result', 'finalState', 'finalStateHash'],
      'replay',
    );
    if (own(record, 'formatVersion') !== 1) throw new ContractError('replay.formatVersion must be 1');
    if (own(record, 'rulesVersion') !== RULES_VERSION) throw new ContractError(`replay.rulesVersion must be ${RULES_VERSION}`);
    const config = parseReplayConfig(own(record, 'config'));
    const turnsValue = own(record, 'turns');
    if (!Array.isArray(turnsValue) || turnsValue.length > MAX_BEATS * 2) {
      throw new ContractError('replay.turns must contain 0..24 turns');
    }
    const turns = turnsValue.map(parseTurn);
    let state = createInitialState({ ...config, coaching: { A: '', B: '' } });
    for (const turn of turns) {
      if (state.phase !== 'active') throw new ContractError('replay has turns after terminal state');
      if (turn.leg !== state.current.leg || turn.turn !== state.current.turn) {
        throw new ContractError('replay turn sequence is stale or discontinuous');
      }
      const resolved = resolveTurn(state, turn.actions);
      if (canonicalString(resolved.events) !== canonicalString(turn.events)) {
        throw new ContractError(`replay events differ at leg ${turn.leg} turn ${turn.turn}`);
      }
      state = resolved.state;
    }
    const abortValue = own(record, 'abort');
    if (abortValue !== null) {
      const abortRecord = asRecord(abortValue, 'replay.abort');
      exactKeys(abortRecord, ['reason'], ['reason'], 'replay.abort');
      const reason = own(abortRecord, 'reason');
      if (reason !== 'turn-timeout' && reason !== 'server-error' && reason !== 'shutdown') {
        throw new ContractError('replay.abort.reason is invalid');
      }
      if (state.phase !== 'active') throw new ContractError('replay abort follows a completed series');
      state = abortGame(state, reason);
    }
    if (state.phase === 'active' || state.result === null) throw new ContractError('replay is missing a terminal transition');
    const expected = exportReplay(state);
    if (canonicalString(own(record, 'events')) !== canonicalString(expected.events)) throw new ContractError('replay flattened events differ');
    if (canonicalString(own(record, 'result')) !== canonicalString(expected.result)) throw new ContractError('replay result differs');
    if (canonicalString(own(record, 'finalState')) !== canonicalString(expected.finalState)) throw new ContractError('replay final state differs');
    if (own(record, 'finalStateHash') !== expected.finalStateHash) throw new ContractError('replay final state hash differs');
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [replayError(error)] };
  }
}

export const RULES_DOCUMENT = {
  rulesVersion: RULES_VERSION,
  graph: graphView(),
  limits: { defenseBudget: DEFENSE_BUDGET, startingHp: STARTING_HP, startingTools: STARTING_TOOLS, toolCap: TOOL_CAP, maxBeats: MAX_BEATS },
  actionGrammar: {
    raider: [
      { type: 'move', target: 'adjacent node' },
      { type: 'breach', target: 'adjacent node', cost: 1 },
      { type: 'scan', target: 'current or adjacent node', cost: 1 },
      { type: 'rest' },
      { type: 'take' },
      { type: 'extract' },
    ],
    sentinel: [{ type: 'move', target: 'adjacent node' }, { type: 'wait' }],
  },
  resolution: ['raider action', 'sentinel movement', 'newly entered trap', 'sentinel co-location', 'extract/death/turn limit'],
  scoring: ['exactly one extraction wins', 'both extract: fewer beats, then greater HP', 'otherwise draw'],
} as const;
