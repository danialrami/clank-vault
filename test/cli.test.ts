import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chooseAction } from '../src/bots.js';
import { runCli } from '../src/cli.js';
import type { Action, Observation, Seat } from '../src/engine.js';
import { createServer } from '../src/server.js';

interface CliResult {
  code: number;
  stdout: string[];
  stderr: string[];
}

async function cli(argv: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(argv, {
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
    env,
  });
  return { code, stdout, stderr };
}

function jsonOutput<T>(result: CliResult): T {
  assert.equal(result.stdout.length, 1, JSON.stringify(result));
  const envelope = JSON.parse(result.stdout[0] ?? '') as { status: string; data: T };
  assert.equal(envelope.status, 'success');
  return envelope.data;
}

test('rules and scripted demo provide deterministic machine output with null external usage', async () => {
  let result = await cli(['rules', '--json']);
  assert.equal(result.code, 0);
  assert.equal(jsonOutput<{ rulesVersion: string }>(result).rulesVersion, 'vault-1');
  result = await cli(['demo', '--json']);
  assert.equal(result.code, 0);
  const demo = jsonOutput<{ mode: string; externalUsage: null; replayVerified: boolean; result: { status: string } }>(result);
  assert.equal(demo.mode, 'scripted');
  assert.equal(demo.externalUsage, null);
  assert.equal(demo.replayVerified, true);
  assert.equal(demo.result.status, 'completed');
});

test('CLI create/observe/act/replay/verify completes a full two-seat HTTP series', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'clank-vault-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'config.json');
  const replayPath = join(directory, 'replay.json');
  await writeFile(configPath, JSON.stringify({
    name: 'CLI integration',
    layouts: {
      A: { core: 3, locks: [], traps: [] },
      B: { core: 3, locks: [], traps: [] },
    },
    coaching: { A: 'CLI_A_ONLY', B: 'CLI_B_ONLY' },
    entrants: { A: 'external', B: 'external' },
    styles: {
      A: { raider: 'direct', sentinel: 'patrol' },
      B: { raider: 'direct', sentinel: 'patrol' },
    },
  }), 'utf8');

  const app = createServer({ turnTimeoutMs: 10_000 });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());

  let result = await cli(['create', '--url', address, '--config', configPath, '--json']);
  assert.equal(result.code, 0, result.stderr.join('\n'));
  const created = jsonOutput<{ id: string; hostToken: string; tokens: Record<Seat, string>; view: { phase: string } }>(result);
  const env = { A_TOKEN: created.tokens.A, B_TOKEN: created.tokens.B };

  let counter = 1;
  while (true) {
    const publicResponse = await fetch(`${address}/api/matches/${created.id}`);
    const publicBody = await publicResponse.json() as { data: { view: { phase: string } } };
    if (publicBody.data.view.phase !== 'active') break;
    const observations = {} as Record<Seat, { leg: 1 | 2; turn: number; role: 'raider' | 'sentinel'; observation: Observation }>;
    for (const seat of ['A', 'B'] as const) {
      result = await cli(['observe', '--url', address, '--match', created.id, '--token-env', `${seat}_TOKEN`, '--json'], env);
      assert.equal(result.code, 0, result.stderr.join('\n'));
      const observed = jsonOutput<{ leg: 1 | 2; turn: number; role: 'raider' | 'sentinel'; observation: Observation; coachingNote: string }>(result);
      observations[seat] = observed;
      assert.equal(observed.coachingNote, `CLI_${seat}_ONLY`);
      assert(!JSON.stringify(observed).includes(`CLI_${seat === 'A' ? 'B' : 'A'}_ONLY`));
    }
    const selected = {} as Record<Seat, Action>;
    for (const seat of ['A', 'B'] as const) {
      const observed = observations[seat];
      selected[seat] = chooseAction(observed.observation, observed.role === 'raider' ? 'direct' : 'patrol');
    }
    for (const seat of ['A', 'B'] as const) {
      const observed = observations[seat];
      result = await cli([
        'act', '--url', address, '--match', created.id,
        '--leg', String(observed.leg), '--turn', String(observed.turn),
        '--action', JSON.stringify(selected[seat]), '--request-id', `cli-${counter}-${seat}`,
        '--token-env', `${seat}_TOKEN`, '--json',
      ], env);
      assert.equal(result.code, 0, result.stderr.join('\n'));
    }
    counter += 1;
    assert(counter < 30);
  }

  result = await cli(['replay', '--url', address, '--match', created.id, '--out', replayPath, '--json']);
  assert.equal(result.code, 0, result.stderr.join('\n'));
  const replayResult = jsonOutput<{ writtenTo: string; replay: { result: { status: string } } }>(result);
  assert.equal(replayResult.writtenTo, replayPath);
  assert.equal(replayResult.replay.result.status, 'completed');
  result = await cli(['verify', replayPath, '--json']);
  assert.equal(result.code, 0, result.stderr.join('\n'));
  assert.equal(jsonOutput<{ ok: boolean }>(result).ok, true);
  const replayText = await readFile(replayPath, 'utf8');
  assert(!replayText.includes(created.tokens.A));
  assert(!replayText.includes(created.hostToken));
  assert(!replayText.includes('CLI_A_ONLY'));
});

test('CLI reports usage, transport, and contract failures with documented exits', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'clank-vault-cli-errors-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const badReplayPath = join(directory, 'bad.json');
  await writeFile(badReplayPath, JSON.stringify({ rulesVersion: 'vault-1' }), 'utf8');

  let result = await cli(['nonesuch', '--json']);
  assert.equal(result.code, 2);
  assert.equal((JSON.parse(result.stdout[0] ?? '{}') as { code: number }).code, 2);

  result = await cli(['observe', '--url', 'http://127.0.0.1:3210', '--match', 'x', '--token-env', 'MISSING', '--json'], {});
  assert.equal(result.code, 2);

  result = await cli(['create', '--url', 'http://127.0.0.1:1', '--config', badReplayPath, '--json']);
  assert.equal(result.code, 3);

  result = await cli(['verify', badReplayPath, '--json']);
  assert.equal(result.code, 5);
  assert.match((JSON.parse(result.stdout[0] ?? '{}') as { message: string }).message, /verification failed/u);

  result = await cli(['act', '--url', 'not-a-url', '--match', 'x', '--leg', '1', '--turn', '1', '--action', '{}', '--request-id', 'x', '--token-env', 'TOKEN', '--json'], { TOKEN: 'secret' });
  assert.equal(result.code, 2);
});
