#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chooseAction } from './bots.js';
import {
  ContractError,
  RULES_DOCUMENT,
  SEATS,
  createInitialState,
  exportReplay,
  observe,
  resolveTurn,
  verifyReplay,
  type Action,
  type MatchConfig,
  type Seat,
} from './engine.js';
import { createServer } from './server.js';

const EXIT_SUCCESS = 0;
const EXIT_USAGE = 2;
const EXIT_TRANSPORT = 3;
const EXIT_CONTRACT = 5;

interface CliIo {
  out(text: string): void;
  err(text: string): void;
  env: NodeJS.ProcessEnv;
  fetch: typeof globalThis.fetch;
}

interface ParsedArgs {
  command: string;
  json: boolean;
  options: Map<string, string | true>;
  positional: string[];
}

class CliFailure extends Error {
  public constructor(public readonly exitCode: number, message: string) {
    super(message);
  }
}

const defaultIo: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  env: process.env,
  fetch: globalThis.fetch,
};

function usage(): string {
  return [
    'Clank Vault CLI',
    '  clank-vault serve [--host 127.0.0.1] [--port 3210] [--turn-timeout-ms 60000] [--json]',
    '  clank-vault rules [--json]',
    '  clank-vault create --url URL --config FILE [--json]',
    '  clank-vault observe --url URL --match ID --token-env NAME [--json]',
    '  clank-vault act --url URL --match ID --leg N --turn N --action JSON --request-id ID --token-env NAME [--json]',
    '  clank-vault replay --url URL --match ID [--out FILE] [--json]',
    '  clank-vault verify FILE [--json]',
    '  clank-vault demo [--out FILE] [--json]',
    '',
    'Seat/host tokens are read only from the environment variable named by --token-env.',
  ].join('\n');
}

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  serve: ['host', 'port', 'turn-timeout-ms'],
  rules: [],
  create: ['url', 'config'],
  observe: ['url', 'match', 'token-env'],
  act: ['url', 'match', 'leg', 'turn', 'action', 'request-id', 'token-env'],
  replay: ['url', 'match', 'out'],
  verify: [],
  demo: ['out'],
};

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) throw new CliFailure(EXIT_USAGE, usage());
  const command = argv[0];
  if (command === undefined || !Object.hasOwn(ALLOWED, command)) throw new CliFailure(EXIT_USAGE, `unknown command\n${usage()}`);
  const options = new Map<string, string | true>();
  const positional: string[] = [];
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === undefined) continue;
    if (value === '--json') {
      json = true;
      continue;
    }
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (!(ALLOWED[command] ?? []).includes(key)) throw new CliFailure(EXIT_USAGE, `unknown option --${key} for ${command}`);
    if (options.has(key)) throw new CliFailure(EXIT_USAGE, `duplicate option --${key}`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new CliFailure(EXIT_USAGE, `--${key} requires a value`);
    options.set(key, next);
    index += 1;
  }
  return { command, json, options, positional };
}

function option(args: ParsedArgs, key: string, required = false): string | undefined {
  const value = args.options.get(key);
  if (value === true) throw new CliFailure(EXIT_USAGE, `--${key} requires a value`);
  if (value === undefined && required) throw new CliFailure(EXIT_USAGE, `missing --${key}`);
  return value;
}

function integerOption(args: ParsedArgs, key: string, fallback: number, minimum: number, maximum: number): number {
  const raw = option(args, key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/u.test(raw)) throw new CliFailure(EXIT_USAGE, `--${key} must be an integer`);
  const value = Number(raw);
  if (value < minimum || value > maximum) throw new CliFailure(EXIT_USAGE, `--${key} must be ${minimum}..${maximum}`);
  return value;
}

function cleanUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliFailure(EXIT_USAGE, '--url must be an absolute http(s) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new CliFailure(EXIT_USAGE, '--url must use http or https');
  parsed.pathname = parsed.pathname.replace(/\/$/u, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/u, '');
}

function envelope(status: 'success' | 'error', dataOrMessage: unknown, code = 0): string {
  return status === 'success'
    ? JSON.stringify({ status, data: dataOrMessage })
    : JSON.stringify({ status, code, message: String(dataOrMessage) });
}

function print(args: ParsedArgs, io: CliIo, value: unknown, human?: string): void {
  io.out(args.json ? envelope('success', value) : human ?? JSON.stringify(value, null, 2));
}

async function jsonFile(path: string, label: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    throw new CliFailure(EXIT_USAGE, `${label} could not be read: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  if (Buffer.byteLength(source) > 1_000_000) throw new CliFailure(EXIT_CONTRACT, `${label} exceeds 1MB`);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new CliFailure(EXIT_CONTRACT, `${label} is not valid JSON`);
  }
}

function bearer(args: ParsedArgs, io: CliIo): string {
  const variable = option(args, 'token-env', true);
  if (variable === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(variable)) throw new CliFailure(EXIT_USAGE, '--token-env must name a valid environment variable');
  const token = io.env[variable];
  if (token === undefined || token.length === 0) throw new CliFailure(EXIT_USAGE, `environment variable ${variable} is empty or missing`);
  return token;
}

async function requestJson(io: CliIo, url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await io.fetch(url, init);
  } catch (error) {
    throw new CliFailure(EXIT_TRANSPORT, `transport failure: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CliFailure(EXIT_TRANSPORT, `server returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    const message = typeof record.message === 'string' ? record.message : `HTTP ${response.status}`;
    throw new CliFailure(response.status >= 500 ? EXIT_TRANSPORT : EXIT_CONTRACT, message);
  }
  return { status: response.status, body };
}

function unwrap(body: unknown): unknown {
  if (typeof body === 'object' && body !== null && (body as Record<string, unknown>).status === 'success') {
    return (body as Record<string, unknown>).data;
  }
  return body;
}

async function commandServe(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.positional.length > 0) throw new CliFailure(EXIT_USAGE, 'serve takes no positional arguments');
  const host = option(args, 'host') ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0' && host !== '::1') throw new CliFailure(EXIT_USAGE, '--host must be 127.0.0.1, ::1, or 0.0.0.0');
  const port = integerOption(args, 'port', 3210, 1, 65535);
  const turnTimeoutMs = integerOption(args, 'turn-timeout-ms', 60_000, 10, 3_600_000);
  if (host === '0.0.0.0') io.err('LAN WARNING: listening on every interface. Use only on a trusted LAN; bearer capabilities are not transport encryption.');
  const app = createServer({ host, port, turnTimeoutMs });
  await app.listen({ host, port });
  print(args, io, { host, port, rulesVersion: RULES_DOCUMENT.rulesVersion, status: 'listening' }, `Clank Vault listening on http://${host}:${port}`);
  const close = async (): Promise<void> => {
    await app.close();
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  await new Promise<void>((resolve) => app.addHook('onClose', async () => resolve()));
  return EXIT_SUCCESS;
}

async function commandCreate(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.positional.length > 0) throw new CliFailure(EXIT_USAGE, 'create takes no positional arguments');
  const url = cleanUrl(option(args, 'url', true) ?? '');
  const configPath = option(args, 'config', true) ?? '';
  const config = await jsonFile(configPath, 'config');
  const response = await requestJson(io, `${url}/api/matches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = unwrap(response.body);
  print(args, io, data);
  return EXIT_SUCCESS;
}

async function commandObserve(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.positional.length > 0) throw new CliFailure(EXIT_USAGE, 'observe takes no positional arguments');
  const url = cleanUrl(option(args, 'url', true) ?? '');
  const id = encodeURIComponent(option(args, 'match', true) ?? '');
  const response = await requestJson(io, `${url}/api/matches/${id}/observe`, { headers: { authorization: `Bearer ${bearer(args, io)}` } });
  print(args, io, unwrap(response.body));
  return EXIT_SUCCESS;
}

async function commandAct(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.positional.length > 0) throw new CliFailure(EXIT_USAGE, 'act takes no positional arguments');
  const url = cleanUrl(option(args, 'url', true) ?? '');
  const id = encodeURIComponent(option(args, 'match', true) ?? '');
  const actionText = option(args, 'action', true) ?? '';
  let action: unknown;
  try {
    action = JSON.parse(actionText) as unknown;
  } catch {
    throw new CliFailure(EXIT_USAGE, '--action must be valid JSON');
  }
  const leg = integerOption(args, 'leg', 0, 1, 2);
  const turn = integerOption(args, 'turn', 0, 1, 12);
  const requestId = option(args, 'request-id', true) ?? '';
  const response = await requestJson(io, `${url}/api/matches/${id}/actions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer(args, io)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ leg, turn, action, requestId }),
  });
  print(args, io, unwrap(response.body));
  return EXIT_SUCCESS;
}

async function commandReplay(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.positional.length > 0) throw new CliFailure(EXIT_USAGE, 'replay takes no positional arguments');
  const url = cleanUrl(option(args, 'url', true) ?? '');
  const id = encodeURIComponent(option(args, 'match', true) ?? '');
  const response = await requestJson(io, `${url}/api/matches/${id}/replay`);
  const replay = response.body;
  const output = option(args, 'out');
  if (output !== undefined) await writeFile(output, `${JSON.stringify(replay, null, 2)}\n`, 'utf8');
  print(args, io, { replay, writtenTo: output ?? null }, output === undefined ? JSON.stringify(replay, null, 2) : `Replay written to ${output}`);
  return EXIT_SUCCESS;
}

async function commandVerify(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.positional.length !== 1) throw new CliFailure(EXIT_USAGE, 'verify requires exactly one replay file');
  const result = verifyReplay(await jsonFile(args.positional[0] ?? '', 'replay'));
  if (!result.ok) throw new CliFailure(EXIT_CONTRACT, `replay verification failed: ${result.errors.join('; ')}`);
  print(args, io, result, 'Replay verified: deterministic transitions, outcome, final state, and hash agree.');
  return EXIT_SUCCESS;
}

function demoConfig(): MatchConfig {
  return {
    name: 'Scripted demo',
    layouts: {
      A: { core: 3, locks: [1], traps: [2] },
      B: { core: 3, locks: [2], traps: [1] },
    },
    entrants: { A: 'scripted', B: 'scripted' },
    styles: {
      A: { raider: 'direct', sentinel: 'patrol' },
      B: { raider: 'direct', sentinel: 'patrol' },
    },
    coaching: { A: '', B: '' },
  };
}

function playDemo() {
  let state = createInitialState(demoConfig());
  let guard = 0;
  while (state.phase === 'active' && guard < 24) {
    guard += 1;
    const actions = {} as Record<Seat, Action>;
    for (const seat of SEATS) {
      const view = observe(state, seat);
      const style = view.role === 'raider' ? state.config.styles[seat].raider : state.config.styles[seat].sentinel;
      actions[seat] = chooseAction(view, style);
    }
    state = resolveTurn(state, actions).state;
  }
  if (state.phase === 'active') throw new ContractError('scripted demo failed to terminate');
  return exportReplay(state);
}

async function commandDemo(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.positional.length > 0) throw new CliFailure(EXIT_USAGE, 'demo takes no positional arguments');
  const replay = playDemo();
  const verification = verifyReplay(replay);
  if (!verification.ok) throw new CliFailure(EXIT_CONTRACT, `internal demo replay failed verification: ${verification.errors.join('; ')}`);
  const output = option(args, 'out');
  if (output !== undefined) await writeFile(output, `${JSON.stringify(replay, null, 2)}\n`, 'utf8');
  print(args, io, { mode: 'scripted', externalUsage: null, result: replay.result, replayVerified: true, writtenTo: output ?? null }, `Scripted demo complete: ${replay.result.winner === null ? 'draw' : `seat ${replay.result.winner} wins`}. External usage: unverified/null.`);
  return EXIT_SUCCESS;
}

export async function runCli(argv: string[], overrides: Partial<CliIo> = {}): Promise<number> {
  const io: CliIo = { ...defaultIo, ...overrides };
  let args: ParsedArgs | null = null;
  try {
    args = parseArgs(argv);
    switch (args.command) {
      case 'serve': return await commandServe(args, io);
      case 'rules':
        if (args.positional.length > 0) throw new CliFailure(EXIT_USAGE, 'rules takes no positional arguments');
        print(args, io, RULES_DOCUMENT);
        return EXIT_SUCCESS;
      case 'create': return await commandCreate(args, io);
      case 'observe': return await commandObserve(args, io);
      case 'act': return await commandAct(args, io);
      case 'replay': return await commandReplay(args, io);
      case 'verify': return await commandVerify(args, io);
      case 'demo': return await commandDemo(args, io);
      default: throw new CliFailure(EXIT_USAGE, 'unknown command');
    }
  } catch (error) {
    const failure = error instanceof CliFailure
      ? error
      : error instanceof ContractError
        ? new CliFailure(EXIT_CONTRACT, error.message)
        : new CliFailure(EXIT_TRANSPORT, error instanceof Error ? error.message : 'unknown failure');
    const useJson = args?.json ?? argv.includes('--json');
    (useJson ? io.out : io.err)(useJson ? envelope('error', failure.message, failure.exitCode) : failure.message);
    return failure.exitCode;
  }
}

const launchedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (launchedDirectly) {
  process.exitCode = await runCli(process.argv.slice(2));
}
