import { chooseAction } from '../src/bots.js';
import { SEATS, createInitialState, exportReplay, observe, resolveTurn, verifyReplay, type Action, type Seat } from '../src/engine.js';

let state = createInitialState({
  name: 'Verification fixture',
  layouts: {
    A: { core: 3, locks: [], traps: [] },
    B: { core: 3, locks: [], traps: [] },
  },
  entrants: { A: 'scripted', B: 'scripted' },
  styles: {
    A: { raider: 'direct', sentinel: 'patrol' },
    B: { raider: 'direct', sentinel: 'patrol' },
  },
});

while (state.phase === 'active') {
  const actions = {} as Record<Seat, Action>;
  for (const seat of SEATS) {
    const view = observe(state, seat);
    const style = view.role === 'raider' ? state.config.styles[seat].raider : state.config.styles[seat].sentinel;
    actions[seat] = chooseAction(view, style);
  }
  state = resolveTurn(state, actions).state;
}

const replay = exportReplay(state);
const verified = verifyReplay(replay);
if (!verified.ok) {
  process.stderr.write(`${verified.errors.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`verified deterministic ${replay.turns.length}-turn replay ${replay.finalStateHash}\n`);
}
