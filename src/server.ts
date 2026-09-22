import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { chooseAction, SCRIPTED_POLICY_INFO } from './bots.js';
import {
  ContractError,
  RULES_DOCUMENT,
  RULES_VERSION,
  SEATS,
  abortGame,
  createInitialState,
  exportReplay,
  legalActions,
  observe,
  publicView,
  resolveTurn,
  validateAction,
  validateMatchConfig,
  verifyReplay,
  type Action,
  type GameState,
  type MatchConfig,
  type Seat,
} from './engine.js';

const VERSION = '1.0.0';
const DEFAULT_MATCH_CAP = 32;
const DEFAULT_SSE_CAP = 8;
const MAX_REQUEST_ID = 100;
const STATIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

type TimerHandle = unknown;

export interface Clock {
  setTimeout(callback: () => void, milliseconds: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface CreateServerOptions {
  host?: string;
  port?: number;
  turnTimeoutMs?: number;
  maxMatches?: number;
  maxSsePerMatch?: number;
  clock?: Clock;
  resolveTurnImpl?: typeof resolveTurn;
}

interface PendingAction {
  seat: Seat;
  action: Action;
  leg: 1 | 2;
  turn: number;
  requestId: string;
  fingerprint: string;
}

interface Receipt {
  fingerprint: string;
  response: Record<string, unknown>;
}

interface SseClient {
  reply: FastifyReply;
  heartbeat: ReturnType<typeof setInterval>;
}

interface StoredMatch {
  id: string;
  hostToken: string;
  seatTokens: Record<Seat, string>;
  state: GameState;
  pending: Partial<Record<Seat, PendingAction>>;
  receipts: Map<string, Receipt>;
  timer: TimerHandle | null;
  sse: Set<SseClient>;
  createdAt: number;
}

interface ActionEnvelope {
  leg: 1 | 2;
  turn: number;
  action: Action;
  requestId: string;
}

interface MatchCredentials {
  id: string;
  hostToken: string;
  tokens: Record<Seat, string>;
  view: ReturnType<typeof publicView>;
}

const defaultClock: Clock = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function success(data: unknown): { status: 'success'; data: unknown } {
  return { status: 'success', data };
}

function fail(reply: FastifyReply, code: number, message: string): FastifyReply {
  return reply.code(code).send({ status: 'error', code, message });
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContractError(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new ContractError(`${label} must be a plain object`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor)) throw new ContractError(`${label}.${key} must be a data property`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[], label: string): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new ContractError(`${label} has unknown field ${key}`);
  for (const key of required) if (!Object.hasOwn(record, key)) throw new ContractError(`${label} is missing ${key}`);
}

function dataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function parsePositiveInteger(value: unknown, label: string, max: number): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > max) {
    throw new ContractError(`${label} must be an integer from 1 to ${max}`);
  }
  return value;
}

function parseActionEnvelope(value: unknown): ActionEnvelope {
  const record = plainRecord(value, 'body');
  exactKeys(record, ['leg', 'turn', 'action', 'requestId'], ['leg', 'turn', 'action', 'requestId'], 'body');
  const legValue = parsePositiveInteger(dataValue(record, 'leg'), 'body.leg', 2);
  const requestIdValue = dataValue(record, 'requestId');
  if (typeof requestIdValue !== 'string' || requestIdValue.length < 1 || requestIdValue.length > MAX_REQUEST_ID || !/^[A-Za-z0-9._:-]+$/u.test(requestIdValue)) {
    throw new ContractError('body.requestId must be 1..100 safe characters');
  }
  return {
    leg: legValue as 1 | 2,
    turn: parsePositiveInteger(dataValue(record, 'turn'), 'body.turn', 12),
    action: validateAction(dataValue(record, 'action')),
    requestId: requestIdValue,
  };
}

function tokenFrom(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9_-]{16,})$/u.exec(header);
  return match?.[1] ?? null;
}

function seatFor(match: StoredMatch, token: string | null): Seat | null {
  if (token === null) return null;
  if (token === match.seatTokens.A) return 'A';
  if (token === match.seatTokens.B) return 'B';
  return null;
}

function freshToken(): string {
  return randomBytes(24).toString('base64url');
}

function matchData(match: StoredMatch): MatchCredentials {
  return {
    id: match.id,
    hostToken: match.hostToken,
    tokens: { ...match.seatTokens },
    view: publicView(match.state),
  };
}

function fingerprint(envelope: ActionEnvelope): string {
  return JSON.stringify({ leg: envelope.leg, turn: envelope.turn, action: envelope.action });
}

function publicSnapshot(match: StoredMatch): string {
  return `event: snapshot\ndata: ${JSON.stringify({ id: match.id, view: publicView(match.state) })}\n\n`;
}

export function createServer(options: CreateServerOptions = {}): FastifyInstance {
  const turnTimeoutMs = options.turnTimeoutMs ?? 60_000;
  const maxMatches = options.maxMatches ?? DEFAULT_MATCH_CAP;
  const maxSsePerMatch = options.maxSsePerMatch ?? DEFAULT_SSE_CAP;
  if (!Number.isInteger(turnTimeoutMs) || turnTimeoutMs < 10 || turnTimeoutMs > 3_600_000) throw new ContractError('turnTimeoutMs must be 10..3600000');
  if (!Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > 1_000) throw new ContractError('maxMatches must be 1..1000');
  if (!Number.isInteger(maxSsePerMatch) || maxSsePerMatch < 1 || maxSsePerMatch > 32) throw new ContractError('maxSsePerMatch must be 1..32');

  const clock = options.clock ?? defaultClock;
  const transition = options.resolveTurnImpl ?? resolveTurn;
  const matches = new Map<string, StoredMatch>();
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, requestTimeout: 30_000 });

  const getMatch = (id: string): StoredMatch | null => matches.get(id) ?? null;

  const broadcast = (match: StoredMatch): void => {
    const payload = publicSnapshot(match);
    for (const client of [...match.sse]) {
      if (client.reply.raw.destroyed || client.reply.raw.writableEnded) {
        clearInterval(client.heartbeat);
        match.sse.delete(client);
      } else {
        client.reply.raw.write(payload);
      }
    }
  };

  const stopTimer = (match: StoredMatch): void => {
    if (match.timer !== null) {
      clock.clearTimeout(match.timer);
      match.timer = null;
    }
  };

  const armTimer = (match: StoredMatch): void => {
    stopTimer(match);
    if (match.state.phase !== 'active') return;
    match.timer = clock.setTimeout(() => {
      if (match.state.phase !== 'active') return;
      match.pending = {};
      match.state = abortGame(match.state, 'turn-timeout');
      match.timer = null;
      broadcast(match);
    }, turnTimeoutMs);
  };

  const abortServerFailure = (match: StoredMatch): void => {
    stopTimer(match);
    match.pending = {};
    match.state = abortGame(match.state, 'server-error');
    broadcast(match);
  };

  const runResolvedTurn = (match: StoredMatch, actions: Record<Seat, Action>): boolean => {
    try {
      match.state = transition(match.state, actions).state;
      match.pending = {};
      if (match.state.phase === 'active') armTimer(match);
      else stopTimer(match);
      broadcast(match);
      return true;
    } catch {
      for (const client of match.sse) {
        clearInterval(client.heartbeat);
        client.reply.raw.end();
      }
      match.sse.clear();
      abortServerFailure(match);
      return false;
    }
  };

  const runBots = (match: StoredMatch): void => {
    let guard = 0;
    while (match.state.phase === 'active' && guard < 24) {
      guard += 1;
      const actions = {} as Record<Seat, Action>;
      let complete = true;
      for (const seat of SEATS) {
        const pending = match.pending[seat];
        if (pending !== undefined) {
          actions[seat] = pending.action;
          continue;
        }
        if (match.state.config.entrants[seat] !== 'scripted') {
          complete = false;
          continue;
        }
        const view = observe(match.state, seat);
        const style = view.role === 'raider' ? match.state.config.styles[seat].raider : match.state.config.styles[seat].sentinel;
        try {
          actions[seat] = chooseAction(view, style);
        } catch {
          abortServerFailure(match);
          return;
        }
      }
      if (!complete) return;
      if (!runResolvedTurn(match, actions)) return;
    }
    if (guard >= 24 && match.state.phase === 'active') abortServerFailure(match);
  };

  const createStoredMatch = (config: MatchConfig): StoredMatch => {
    if (matches.size >= maxMatches) throw Object.assign(new Error('match capacity reached'), { statusCode: 429 });
    const state = createInitialState(config);
    const match: StoredMatch = {
      id: randomUUID(),
      hostToken: freshToken(),
      seatTokens: { A: freshToken(), B: freshToken() },
      state,
      pending: {},
      receipts: new Map(),
      timer: null,
      sse: new Set(),
      createdAt: Date.now(),
    };
    matches.set(match.id, match);
    armTimer(match);
    runBots(match);
    return match;
  };

  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST') return;
    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
      return fail(reply, 415, 'mutation routes require application/json');
    }
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (typeof origin !== 'string') return fail(reply, 403, 'foreign Origin rejected');
      try {
        const parsed = new URL(origin);
        const expectedOrigin = `${request.protocol}://${request.headers.host ?? ''}`;
        if (parsed.origin !== expectedOrigin || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
          return fail(reply, 403, 'foreign Origin rejected');
        }
      } catch {
        return fail(reply, 403, 'foreign Origin rejected');
      }
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setNotFoundHandler((_request, reply) => fail(reply, 404, 'route not found'));

  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as Error & { statusCode?: number; code?: string };
    const statusCode = candidate.statusCode === 413 || candidate.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
      ? 413
      : candidate.statusCode === 429
        ? 429
        : candidate.statusCode === 415
          ? 415
          : candidate instanceof ContractError || (typeof candidate.statusCode === 'number' && candidate.statusCode >= 400 && candidate.statusCode < 500) ? 400 : 500;
    const message = statusCode === 413 ? 'request body exceeds this route limit' : statusCode === 429 ? 'match capacity reached' : statusCode === 415 ? 'unsupported media type' : statusCode === 500 ? 'internal server error' : candidate instanceof ContractError ? candidate.message : 'invalid request';
    void fail(reply, statusCode, message);
  });

  app.get('/api/status', async () => {
    const states = { active: 0, completed: 0, aborted: 0 };
    for (const match of matches.values()) states[match.state.phase] += 1;
    return success({ game: 'clank-vault', version: VERSION, rulesVersion: RULES_VERSION, process: 'ready', storage: 'ephemeral-memory', matches: { total: matches.size, ...states } });
  });

  app.get('/api/rules', async () => success(RULES_DOCUMENT));

  app.post('/api/matches', async (request, reply) => {
    try {
      const config = validateMatchConfig(request.body);
      const match = createStoredMatch(config);
      return reply.code(201).send(success(matchData(match)));
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 429) return fail(reply, 429, 'match capacity reached');
      if (error instanceof ContractError) return fail(reply, 400, error.message);
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>('/api/matches/:id', async (request, reply) => {
    const match = getMatch(request.params.id);
    if (match === null) return fail(reply, 404, 'unknown match');
    return success({ id: match.id, view: publicView(match.state) });
  });

  app.get<{ Params: { id: string } }>('/api/matches/:id/observe', async (request, reply) => {
    const match = getMatch(request.params.id);
    if (match === null) return fail(reply, 404, 'unknown match');
    const seat = seatFor(match, tokenFrom(request));
    if (seat === null) return fail(reply, 401, 'missing or invalid seat bearer');
    const observation = observe(match.state, seat);
    return success({
      id: match.id,
      leg: observation.leg,
      turn: observation.turn,
      role: observation.role,
      observation,
      legalActions: legalActions(match.state, seat),
      coachingNote: match.state.config.coaching[seat],
      entrant: match.state.config.entrants[seat],
      scriptedPolicy: match.state.config.entrants[seat] === 'scripted' ? SCRIPTED_POLICY_INFO : null,
      externalUsage: null,
    });
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/actions', async (request, reply) => {
    const match = getMatch(request.params.id);
    if (match === null) return fail(reply, 404, 'unknown match');
    const seat = seatFor(match, tokenFrom(request));
    if (seat === null) return fail(reply, 401, 'missing or invalid seat bearer');
    let envelope: ActionEnvelope;
    try {
      envelope = parseActionEnvelope(request.body);
    } catch (error) {
      return fail(reply, 400, error instanceof Error ? error.message : 'invalid action envelope');
    }
    const receiptKey = `${seat}:${envelope.requestId}`;
    const actionFingerprint = fingerprint(envelope);
    const existingReceipt = match.receipts.get(receiptKey);
    if (existingReceipt !== undefined) {
      if (existingReceipt.fingerprint !== actionFingerprint) return fail(reply, 409, 'conflicting duplicate requestId');
      return success({ ...existingReceipt.response, idempotent: true });
    }
    if (match.state.phase !== 'active') return fail(reply, 409, 'match is terminal');
    if (envelope.leg !== match.state.current.leg) return fail(reply, 409, 'wrong leg');
    if (envelope.turn !== match.state.current.turn) return fail(reply, 409, 'stale turn');
    if (match.state.config.entrants[seat] === 'scripted') return fail(reply, 409, 'server-owned scripted seat does not accept external actions');
    if (!legalActions(match.state, seat).some((candidate) => JSON.stringify(candidate) === JSON.stringify(envelope.action))) {
      return fail(reply, 400, 'action is not legal for this role and state');
    }
    if (match.pending[seat] !== undefined) return fail(reply, 409, 'seat already submitted this turn');
    const pending: PendingAction = { seat, ...envelope, fingerprint: actionFingerprint };
    match.pending[seat] = pending;
    const initialResponse: Record<string, unknown> = { id: match.id, accepted: true, waiting: true, leg: envelope.leg, turn: envelope.turn, view: publicView(match.state) };
    match.receipts.set(receiptKey, { fingerprint: actionFingerprint, response: initialResponse });

    const submitted = { A: match.pending.A, B: match.pending.B };
    const historyLength = match.state.history.length;
    runBots(match);
    if ((match.state.phase as GameState['phase']) === 'aborted' && match.state.result?.reason === 'server-error') {
      return fail(reply, 500, 'scripted policy or referee failure aborted match');
    }
    if (match.state.history.length !== historyLength || match.state.phase !== 'active') {
      const resolvedResponse: Record<string, unknown> = { id: match.id, accepted: true, waiting: false, resolved: true, view: publicView(match.state) };
      for (const queued of [submitted.A, submitted.B]) {
        if (queued !== undefined) match.receipts.set(`${queued.seat}:${queued.requestId}`, { fingerprint: queued.fingerprint, response: resolvedResponse });
      }
      return success(resolvedResponse);
    }
    return success(initialResponse);
  });

  app.get<{ Params: { id: string } }>('/api/matches/:id/stream', async (request, reply) => {
    const match = getMatch(request.params.id);
    if (match === null) return fail(reply, 404, 'unknown match');
    if (match.sse.size >= maxSsePerMatch) return fail(reply, 429, 'SSE connection cap reached');
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    reply.raw.write('retry: 3000\n');
    reply.raw.write(publicSnapshot(match));
    const client: SseClient = {
      reply,
      heartbeat: setInterval(() => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(': heartbeat\n\n');
      }, 15_000),
    };
    client.heartbeat.unref();
    match.sse.add(client);
    request.raw.on('close', () => {
      clearInterval(client.heartbeat);
      match.sse.delete(client);
    });
  });

  app.get<{ Params: { id: string } }>('/api/matches/:id/replay', async (request, reply) => {
    const match = getMatch(request.params.id);
    if (match === null) return fail(reply, 404, 'unknown match');
    if (match.state.phase === 'active') return fail(reply, 409, 'replay is sealed until the entire series is terminal');
    const replay = exportReplay(match.state);
    reply.type('application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="clank-vault-${match.id}.json"`);
    return replay;
  });

  app.post<{ Params: { id: string } }>('/api/matches/:id/rematch', async (request, reply) => {
    const source = getMatch(request.params.id);
    if (source === null) return fail(reply, 404, 'unknown match');
    if (tokenFrom(request) !== source.hostToken) return fail(reply, 401, 'missing or invalid host bearer');
    let config: ReturnType<typeof validateMatchConfig>;
    try {
      const record = plainRecord(request.body, 'body');
      exactKeys(record, ['config'], ['config'], 'body');
      config = validateMatchConfig(dataValue(record, 'config'));
    } catch (error) {
      return fail(reply, 400, error instanceof Error ? error.message : 'invalid rematch config');
    }
    try {
      const rematch = createStoredMatch(config);
      return reply.code(201).send(success(matchData(rematch)));
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 429) return fail(reply, 429, 'match capacity reached');
      throw error;
    }
  });

  app.post('/api/replays/verify', { bodyLimit: 512 * 1024 }, async (request, reply) => {
    const verification = verifyReplay(request.body);
    if (!verification.ok) return fail(reply, 400, `replay verification failed: ${verification.errors.join('; ')}`);
    return success(verification);
  });

  const staticRoute = (path: string, filename: string, type: string): void => {
    app.get(path, async (_request, reply) => {
      const body = await readFile(`${STATIC_DIR}${filename}`);
      reply.type(type);
      if (filename === 'index.html') {
        reply.header('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      }
      return reply.send(body);
    });
  };
  staticRoute('/', 'index.html', 'text/html; charset=utf-8');
  staticRoute('/app.js', 'app.js', 'text/javascript; charset=utf-8');
  staticRoute('/style.css', 'style.css', 'text/css; charset=utf-8');

  app.addHook('onClose', async () => {
    for (const match of matches.values()) {
      stopTimer(match);
      for (const client of match.sse) {
        clearInterval(client.heartbeat);
        client.reply.raw.end();
      }
      match.sse.clear();
    }
  });

  return app;
}
