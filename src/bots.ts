import type { Action, NodeId, Observation, RaiderStyle, SentinelStyle } from './engine.js';
import { ContractError } from './engine.js';

const ADJACENCY: Readonly<Record<NodeId, readonly NodeId[]>> = {
  0: [1, 2],
  1: [0, 3],
  2: [0, 3],
  3: [1, 2, 4],
  4: [3],
};

function distance(from: NodeId, to: NodeId): number {
  if (from === to) return 0;
  const seen = new Set<NodeId>([from]);
  let frontier: NodeId[] = [from];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: NodeId[] = [];
    for (const node of frontier) {
      for (const candidate of ADJACENCY[node]) {
        if (candidate === to) return depth;
        if (!seen.has(candidate)) {
          seen.add(candidate);
          next.push(candidate);
        }
      }
    }
    frontier = next;
  }
  return 99;
}

function firstStep(from: NodeId, to: NodeId, preference: readonly NodeId[] = [1, 2, 3, 4, 0]): NodeId {
  const options = [...ADJACENCY[from]];
  options.sort((left, right) => {
    const distanceDelta = distance(left, to) - distance(right, to);
    if (distanceDelta !== 0) return distanceDelta;
    return preference.indexOf(left) - preference.indexOf(right);
  });
  const first = options[0];
  if (first === undefined) throw new ContractError('scripted policy found no path');
  return first;
}

function fact(observation: Observation, node: NodeId) {
  return observation.revealedNodes.find((candidate) => candidate.node === node);
}

function raiderTarget(observation: Observation, style: RaiderStyle): NodeId {
  const position = observation.own.position;
  if (observation.own.carryingCore) return firstStep(position, 0, style === 'direct' ? [1, 2, 3, 0, 4] : [2, 1, 3, 0, 4]);
  const knownCore = observation.revealedNodes.find((candidate) => candidate.core === true)?.node;
  if (knownCore !== undefined) return firstStep(position, knownCore);
  if (position === 0) {
    if (style === 'direct') return 1;
    const north = fact(observation, 1);
    const south = fact(observation, 2);
    const northRisk = north?.trap === 'live' ? 10 : north?.scanned ? 0 : 2;
    const southRisk = south?.trap === 'live' ? 10 : south?.scanned ? 0 : 2;
    return southRisk < northRisk ? 2 : 1;
  }
  if (position === 1 || position === 2) return 3;
  return 4;
}

function chooseRaider(observation: Observation, style: RaiderStyle): Action {
  const position = observation.own.position;
  const hp = observation.own.hp;
  const tools = observation.own.tools;
  if (hp === null || tools === null) throw new ContractError('raider observation lacks resources');
  if (observation.own.carryingCore && position === 0) return { type: 'extract' };
  if (fact(observation, position)?.core === true && !observation.own.carryingCore) return { type: 'take' };
  const target = raiderTarget(observation, style);
  const targetFact = fact(observation, target);
  if (targetFact?.lock === 'live') {
    return tools > 0 ? { type: 'breach', target } : { type: 'rest' };
  }
  if (style === 'cautious' && targetFact?.lock === 'unknown' && tools > 1) {
    return { type: 'scan', target };
  }
  return { type: 'move', target };
}

function chooseSentinel(observation: Observation, style: SentinelStyle): Action {
  const position = observation.own.position;
  const raider = observation.opponent.position;
  if (style === 'pursuit') {
    if (raider === null || raider === position) return { type: 'wait' };
    return { type: 'move', target: firstStep(position, raider, [3, 1, 2, 0, 4]) };
  }
  const patrol: Readonly<Record<NodeId, NodeId>> = { 0: 2, 1: 0, 2: 3, 3: 1, 4: 3 };
  return { type: 'move', target: patrol[position] };
}

export function chooseAction(observation: Observation, style: string): Action {
  if (observation.phase !== 'active') throw new ContractError('scripted policy cannot act on a terminal observation');
  if (observation.role === 'raider') {
    if (style !== 'cautious' && style !== 'direct') throw new ContractError('raider style must be cautious or direct');
    return chooseRaider(observation, style);
  }
  if (style !== 'patrol' && style !== 'pursuit') throw new ContractError('sentinel style must be patrol or pursuit');
  return chooseSentinel(observation, style);
}

export const SCRIPTED_POLICY_INFO = {
  kind: 'scripted',
  deterministic: true,
  externalUsage: null,
  raiderStyles: ['cautious', 'direct'],
  sentinelStyles: ['patrol', 'pursuit'],
} as const;
