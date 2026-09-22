import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { chooseAction } from '../src/bots.js';
import { verifyReplay, type Action, type Observation, type Seat } from '../src/engine.js';
import { createServer, type Clock } from '../src/server.js';

const openConfig = {
  name: 'HTTP integration',
  layouts: {
    A: { core: 3, locks: [], traps: [] },
    B: { core: 3, locks: [], traps: [] },
  },
  coaching: { A: 'PRIVATE_NOTE_A', B: 'PRIVATE_NOTE_B' },
  entrants: { A: 'external', B: 'external' },
  styles: {
    A: { raider: 'direct', sentinel: 'patrol' },
    B: { raider: 'direct', sentinel: 'patrol' },
  },
} as const;

interface Created {
  id: string;
  hostToken: string;
  tokens: Record<Seat, string>;
  view: { phase: 'active' | 'completed' | 'aborted'; leg: 1 | 2; turn: number };
}

interface Observed {
  id: string;
  leg: 1 | 2;
  turn: number;
  role: 'raider' | 'sentinel';
  observation: Observation;
  legalActions: Action[];
  coachingNote: string;
}

function bodyJson(response: { body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

function dataOf<T>(response: { body: string }): T {
  const body = bodyJson(response) as { status: string; data: T };
  assert.equal(body.status, 'success');
  return body.data;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function jsonAuth(token?: string): Record<string, string> {
  return token === undefined ? { 'content-type': 'application/json' } : { 'content-type': 'application/json', ...auth(token) };
}

async function createExternal(app: ReturnType<typeof createServer>): Promise<Created> {
  const response = await app.inject({ method: 'POST', url: '/api/matches', headers: jsonAuth(), payload: openConfig });
  assert.equal(response.statusCode, 201, response.body);
  return dataOf<Created>(response);
}

async function observeSeat(app: ReturnType<typeof createServer>, created: Created, seat: Seat): Promise<Observed> {
  const response = await app.inject({ method: 'GET', url: `/api/matches/${created.id}/observe`, headers: auth(created.tokens[seat]) });
  assert.equal(response.statusCode, 200, response.body);
  return dataOf<Observed>(response);
}

async function submit(
  app: ReturnType<typeof createServer>,
  created: Created,
  seat: Seat,
  observation: Observed,
  action: Action,
  requestId: string,
) {
  return app.inject({
    method: 'POST',
    url: `/api/matches/${created.id}/actions`,
    headers: jsonAuth(created.tokens[seat]),
    payload: { leg: observation.leg, turn: observation.turn, action, requestId },
  });
}

test('status/rules/static surfaces are honest and reserved paths are absent', async (t) => {
  const app = createServer();
  t.after(() => app.close());
  const status = await app.inject({ method: 'GET', url: '/api/status' });
  assert.equal(status.statusCode, 200);
  const statusData = dataOf<{ game: string; rulesVersion: string; storage: string; process: string }>(status);
  assert.deepEqual(statusData, { game: 'clank-vault', version: '1.0.0', rulesVersion: 'vault-1', process: 'ready', storage: 'ephemeral-memory', matches: { total: 0, active: 0, completed: 0, aborted: 0 } });
  const rules = await app.inject({ method: 'GET', url: '/api/rules' });
  assert.equal(dataOf<{ rulesVersion: string }>(rules).rulesVersion, 'vault-1');
  const page = await app.inject({ method: 'GET', url: '/' });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-security-policy'] ?? '', /default-src 'self'/u);
  assert.match(page.body, /Clank Vault/u);
  for (const path of ['/run', '/events', '/health', '/interrupt', '/keepalive']) {
    assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 404);
  }
});

test('creation validates JSON, Origin, layouts, unknown fields, malicious keys, body size, and match cap', async (t) => {
  const app = createServer({ maxMatches: 1 });
  t.after(() => app.close());
  let response = await app.inject({ method: 'POST', url: '/api/matches', headers: { 'content-type': 'text/plain' }, payload: '{}' });
  assert.equal(response.statusCode, 415);
  response = await app.inject({ method: 'POST', url: '/api/matches', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, payload: openConfig });
  assert.equal(response.statusCode, 403);
  response = await app.inject({ method: 'POST', url: '/api/matches', headers: jsonAuth(), payload: { ...openConfig, extra: true } });
  assert.equal(response.statusCode, 400);
  response = await app.inject({ method: 'POST', url: '/api/matches', headers: jsonAuth(), payload: { ...openConfig, layouts: { ...openConfig.layouts, A: { core: 4, locks: [1, 2, 3], traps: [1, 4] } } } });
  assert.equal(response.statusCode, 400);
  response = await app.inject({ method: 'POST', url: '/api/matches', headers: jsonAuth(), payload: '{"layouts":{"A":{"core":3,"locks":[],"traps":[]},"B":{"core":3,"locks":[],"traps":[]}},"__proto__":{"polluted":true}}' });
  assert.equal(response.statusCode, 400);
  response = await app.inject({ method: 'POST', url: '/api/matches', headers: jsonAuth(), payload: JSON.stringify({ ...openConfig, name: 'x'.repeat(17_000) }) });
  assert.equal(response.statusCode, 413);
  const created = await createExternal(app);
  assert(created.hostToken.length >= 16);
  response = await app.inject({ method: 'POST', url: '/api/matches', headers: jsonAuth(), payload: openConfig });
  assert.equal(response.statusCode, 429);
});

test('auth, pending seals, idempotency, conflicts, stale metadata, full two-client role swap, terminal replay, and immutable rematch', async (t) => {
  const app = createServer({ turnTimeoutMs: 10_000, maxMatches: 4 });
  t.after(() => app.close());
  const created = await createExternal(app);

  let response = await app.inject({ method: 'GET', url: `/api/matches/${created.id}/observe` });
  assert.equal(response.statusCode, 401);
  response = await app.inject({ method: 'GET', url: `/api/matches/${created.id}/observe`, headers: auth('not-a-real-token-value') });
  assert.equal(response.statusCode, 401);
  response = await app.inject({ method: 'GET', url: '/api/matches/missing' });
  assert.equal(response.statusCode, 404);
  response = await app.inject({ method: 'POST', url: `/api/matches/${created.id}/actions`, headers: jsonAuth(), payload: { leg: 1, turn: 1, action: { type: 'rest' }, requestId: 'missing-token' } });
  assert.equal(response.statusCode, 401);
  response = await app.inject({ method: 'GET', url: `/api/matches/${created.id}/replay` });
  assert.equal(response.statusCode, 409);

  let observationA = await observeSeat(app, created, 'A');
  let observationB = await observeSeat(app, created, 'B');
  assert.equal(observationA.coachingNote, 'PRIVATE_NOTE_A');
  assert.equal(observationB.coachingNote, 'PRIVATE_NOTE_B');
  assert(!JSON.stringify(observationA).includes('PRIVATE_NOTE_B'));
  assert.equal(observationA.observation.activeFortress, null);
  assert.deepEqual(observationB.observation.activeFortress, openConfig.layouts.B);

  const firstActionA = chooseAction(observationA.observation, 'direct');
  response = await submit(app, created, 'A', observationA, firstActionA, 'turn-1-A');
  assert.equal(response.statusCode, 200);
  const waiting = dataOf<{ waiting: boolean; view: unknown }>(response);
  assert.equal(waiting.waiting, true);
  const publicPending = await app.inject({ method: 'GET', url: `/api/matches/${created.id}` });
  assert.equal(publicPending.statusCode, 200);
  const serializedPending = publicPending.body;
  assert(!serializedPending.includes('turn-1-A'));
  assert(!serializedPending.includes('pending'));
  assert(!serializedPending.includes('PRIVATE_NOTE'));
  assert(!serializedPending.includes(created.tokens.A));
  assert(!serializedPending.includes(created.hostToken));
  const observationBAfterPending = await observeSeat(app, created, 'B');
  assert.equal(observationBAfterPending.turn, observationB.turn);
  assert(!JSON.stringify(observationBAfterPending).includes('turn-1-A'));

  response = await submit(app, created, 'A', observationA, firstActionA, 'turn-1-A');
  assert.equal(response.statusCode, 200);
  assert.equal(dataOf<{ idempotent: boolean }>(response).idempotent, true);
  response = await submit(app, created, 'A', observationA, { type: 'rest' }, 'turn-1-A');
  assert.equal(response.statusCode, 409);

  const firstActionB = chooseAction(observationB.observation, 'patrol');
  response = await submit(app, created, 'B', observationB, firstActionB, 'turn-1-B');
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(dataOf<{ resolved: boolean }>(response).resolved, true);
  response = await submit(app, created, 'A', observationA, firstActionA, 'turn-1-A');
  assert.equal(response.statusCode, 200);
  const retryData = dataOf<{ idempotent: boolean; resolved: boolean }>(response);
  assert.equal(retryData.idempotent, true);
  assert.equal(retryData.resolved, true);

  response = await submit(app, created, 'A', observationA, { type: 'rest' }, 'stale-new-request');
  assert.equal(response.statusCode, 409);
  const wrongLeg = await app.inject({ method: 'POST', url: `/api/matches/${created.id}/actions`, headers: jsonAuth(created.tokens.A), payload: { leg: 2, turn: 2, action: { type: 'rest' }, requestId: 'wrong-leg' } });
  assert.equal(wrongLeg.statusCode, 409);
  const wrongField = await app.inject({ method: 'POST', url: `/api/matches/${created.id}/actions`, headers: jsonAuth(created.tokens.A), payload: { leg: 1, turn: 2, action: { type: 'rest' }, requestId: 'bad-field', extra: true } });
  assert.equal(wrongField.statusCode, 400);
  const wrongAction = await app.inject({ method: 'POST', url: `/api/matches/${created.id}/actions`, headers: jsonAuth(created.tokens.A), payload: { leg: 1, turn: 2, action: { type: 'wait' }, requestId: 'bad-role' } });
  assert.equal(wrongAction.statusCode, 400);

  let sawLeg2 = false;
  let counter = 2;
  while (true) {
    const publicResponse = await app.inject({ method: 'GET', url: `/api/matches/${created.id}` });
    const publicData = dataOf<{ view: { phase: string; leg: number; turn: number; layouts: unknown; result: unknown } }>(publicResponse);
    if (publicData.view.phase !== 'active') break;
    assert.equal(publicData.view.layouts, null);
    observationA = await observeSeat(app, created, 'A');
    observationB = await observeSeat(app, created, 'B');
    if (observationA.leg === 2) {
      sawLeg2 = true;
      assert.equal(observationA.role, 'sentinel');
      assert.equal(observationB.role, 'raider');
    }
    const actionA = chooseAction(observationA.observation, observationA.role === 'raider' ? 'direct' : 'patrol');
    const actionB = chooseAction(observationB.observation, observationB.role === 'raider' ? 'direct' : 'patrol');
    const order: Seat[] = counter % 2 === 0 ? ['B', 'A'] : ['A', 'B'];
    const map = { A: { observation: observationA, action: actionA }, B: { observation: observationB, action: actionB } };
    for (const seat of order) {
      response = await submit(app, created, seat, map[seat].observation, map[seat].action, `loop-${counter}-${seat}`);
      assert.equal(response.statusCode, 200, response.body);
    }
    counter += 1;
    assert(counter < 30, 'game must terminate within two 12-beat legs');
  }
  assert.equal(sawLeg2, true);

  const terminalPublic = dataOf<{ view: { phase: string; layouts: unknown; result: { status: string; winner: Seat | null } } }>(await app.inject({ method: 'GET', url: `/api/matches/${created.id}` }));
  assert.equal(terminalPublic.view.phase, 'completed');
  assert.deepEqual(terminalPublic.view.layouts, openConfig.layouts);
  assert.equal(terminalPublic.view.result.status, 'completed');

  const replayResponse = await app.inject({ method: 'GET', url: `/api/matches/${created.id}/replay` });
  assert.equal(replayResponse.statusCode, 200, replayResponse.body);
  const replay = bodyJson(replayResponse);
  assert.equal(verifyReplay(replay).ok, true);
  const replayText = replayResponse.body;
  assert(!replayText.includes(created.tokens.A));
  assert(!replayText.includes(created.tokens.B));
  assert(!replayText.includes(created.hostToken));
  assert(!replayText.includes('PRIVATE_NOTE'));
  const frozenReplay = replayResponse.body;

  response = await app.inject({ method: 'POST', url: `/api/matches/${created.id}/rematch`, headers: jsonAuth(created.tokens.A), payload: { config: openConfig } });
  assert.equal(response.statusCode, 401);
  const changedConfig = { ...openConfig, name: 'Immutable rematch', coaching: { A: 'changed', B: '' } };
  response = await app.inject({ method: 'POST', url: `/api/matches/${created.id}/rematch`, headers: jsonAuth(created.hostToken), payload: { config: changedConfig } });
  assert.equal(response.statusCode, 201, response.body);
  const rematch = dataOf<Created>(response);
  assert.notEqual(rematch.id, created.id);
  assert.notEqual(rematch.tokens.A, created.tokens.A);
  assert.equal((await app.inject({ method: 'GET', url: `/api/matches/${created.id}/replay` })).body, frozenReplay);
});

test('injected deadline aborts promptly with no winner and produces a verifiable zero-turn replay', async (t) => {
  const timer: { callback: (() => void) | null } = { callback: null };
  const clock: Clock = {
    setTimeout: (next) => { timer.callback = next; return 1; },
    clearTimeout: () => { timer.callback = null; },
  };
  const app = createServer({ clock, turnTimeoutMs: 50 });
  t.after(() => app.close());
  const created = await createExternal(app);
  const callback = timer.callback;
  assert(callback);
  callback();
  const terminal = dataOf<{ view: { phase: string; result: { status: string; winner: Seat | null; reason: string } } }>(await app.inject({ method: 'GET', url: `/api/matches/${created.id}` }));
  assert.equal(terminal.view.phase, 'aborted');
  assert.deepEqual(terminal.view.result, { status: 'aborted', winner: null, reason: 'turn-timeout' });
  const replayResponse = await app.inject({ method: 'GET', url: `/api/matches/${created.id}/replay` });
  assert.equal(replayResponse.statusCode, 200);
  const replay = bodyJson(replayResponse) as { turns: unknown[] };
  assert.equal(replay.turns.length, 0);
  assert.equal(verifyReplay(replay).ok, true);
});

test('referee exception aborts the series with no tactical winner', async (t) => {
  const app = createServer({ resolveTurnImpl: () => { throw new Error('injected referee failure'); } });
  t.after(() => app.close());
  const created = await createExternal(app);
  const observationA = await observeSeat(app, created, 'A');
  const observationB = await observeSeat(app, created, 'B');
  let response = await submit(app, created, 'A', observationA, { type: 'rest' }, 'failure-A');
  assert.equal(response.statusCode, 200);
  response = await submit(app, created, 'B', observationB, { type: 'wait' }, 'failure-B');
  assert.equal(response.statusCode, 500);
  const terminal = dataOf<{ view: { phase: string; result: { status: string; winner: Seat | null; reason: string } } }>(await app.inject({ method: 'GET', url: `/api/matches/${created.id}` }));
  assert.deepEqual(terminal.view.result, { status: 'aborted', winner: null, reason: 'server-error' });
  assert.equal(verifyReplay(bodyJson(await app.inject({ method: 'GET', url: `/api/matches/${created.id}/replay` }))).ok, true);
});

test('SSE connection count is bounded and snapshots contain no capabilities or private configuration', async (t) => {
  const app = createServer({ maxSsePerMatch: 1 });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const createResponse = await fetch(`${address}/api/matches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openConfig) });
  const createdBody = await createResponse.json() as { data: Created };
  const created = createdBody.data;
  const controller = new AbortController();
  const first = await fetch(`${address}/api/matches/${created.id}/stream`, { signal: controller.signal });
  assert.equal(first.status, 200);
  const reader = first.body?.getReader();
  assert(reader);
  const chunk = await reader.read();
  const text = new TextDecoder().decode(chunk.value);
  assert.match(text, /event: snapshot/u);
  assert(!text.includes(created.tokens.A));
  assert(!text.includes(created.hostToken));
  assert(!text.includes('PRIVATE_NOTE'));
  assert(!text.includes('"layouts":{"A"'));
  const second = await fetch(`${address}/api/matches/${created.id}/stream`);
  assert.equal(second.status, 429);
  controller.abort();
  await reader.cancel().catch(() => undefined);
});


test('internal service errors remain 500 without exposing implementation details', async (t) => {
  const app = createServer();
  t.after(() => app.close());
  app.get('/api/test-internal', async () => { throw new Error('private-internal-detail'); });
  const response = await app.inject({ method: 'GET', url: '/api/test-internal' });
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.includes('private-internal-detail'), false);
});

test('a real exported replay larger than 16KiB round-trips through bounded HTTP verification', async (t) => {
  const app = createServer();
  t.after(() => app.close());
  const replay = JSON.parse(await readFile(new URL('../../fixtures/ciani-smoke-replay.json', import.meta.url), 'utf8'));
  const payload = JSON.stringify(replay);
  assert(Buffer.byteLength(payload) > 16 * 1024);
  const response = await app.inject({ method: 'POST', url: '/api/replays/verify', headers: jsonAuth(), payload });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(dataOf<{ok:boolean}>(response).ok, true);
  const oversized = await app.inject({ method: 'POST', url: '/api/replays/verify', headers: jsonAuth(), payload: JSON.stringify({padding:'x'.repeat(512 * 1024)}) });
  assert.equal(oversized.statusCode, 413);
});
