const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  match: null,
  hostToken: null,
  tokens: { A: null, B: null },
  selectedSeat: 'A',
  eventSource: null,
  replay: null,
  replayIndex: 0,
  requestCounter: 0,
};

const presets = {
  open: {
    A: { core: 3, locks: [], traps: [] },
    B: { core: 3, locks: [], traps: [] },
  },
  max: {
    A: { core: 4, locks: [1, 3], traps: [2, 4] },
    B: { core: 4, locks: [2, 3], traps: [1, 4] },
  },
};

function createDefenseChecks(editor, kind) {
  const host = editor.querySelector(`[data-kind="${kind}"]`);
  for (let node = 1; node <= 4; node += 1) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(node);
    input.dataset.defense = kind;
    input.addEventListener('change', () => {
      $('#preset').value = 'custom';
      updateBudget(editor);
    });
    label.append(input, document.createTextNode(String(node)));
    host.append(label);
  }
}

function updateBudget(editor) {
  const used = editor.querySelectorAll('input[data-defense]:checked').length;
  const budget = editor.querySelector('[data-budget]');
  budget.textContent = `${used} / 4 defense points`;
  budget.classList.toggle('invalid', used > 4);
}

function setLayout(editor, layout) {
  editor.querySelector('[data-field="core"]').value = String(layout.core);
  for (const input of editor.querySelectorAll('input[data-defense]')) {
    input.checked = layout[input.dataset.defense].includes(Number(input.value));
  }
  updateBudget(editor);
}

function readLayout(editor) {
  const selected = (kind) => [...editor.querySelectorAll(`input[data-defense="${kind}"]:checked`)].map((input) => Number(input.value));
  return {
    core: Number(editor.querySelector('[data-field="core"]').value),
    locks: selected('locks'),
    traps: selected('traps'),
  };
}

function buildConfig() {
  return {
    name: $('#match-name').value,
    layouts: { A: readLayout($('#layout-a')), B: readLayout($('#layout-b')) },
    coaching: { A: $('#note-a').value, B: $('#note-b').value },
    entrants: { A: $('#mode-a').value, B: $('#mode-b').value },
    styles: {
      A: { raider: $('#raider-a').value, sentinel: $('#sentinel-a').value },
      B: { raider: $('#raider-b').value, sentinel: $('#sentinel-b').value },
    },
  };
}

async function api(path, options = {}, raw = false) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return raw ? body : body.data;
}

function factLabel(fact) {
  const parts = [];
  if (fact.lock !== 'unknown') parts.push(`lock ${fact.lock}`);
  if (fact.trap !== 'unknown') parts.push(`trap ${fact.trap}`);
  if (fact.core !== null) parts.push(fact.core ? 'CORE' : 'no core');
  return parts.length === 0 ? 'visited; details unknown' : parts.join(' · ');
}

function renderBoard(view) {
  const facts = new Map(view.revealedNodes.map((fact) => [fact.node, fact]));
  for (const node of $$('.node')) {
    const id = Number(node.dataset.node);
    const fact = facts.get(id);
    node.classList.toggle('raider', id === view.raider.position);
    node.classList.toggle('sentinel', id === view.sentinel.position);
    node.classList.toggle('revealed', Boolean(fact));
    node.querySelector('small').textContent = fact ? factLabel(fact) : id === 0 ? 'public' : 'unknown';
  }
  $('#stats').replaceChildren(
    stat(`Leg ${view.leg} / 2`),
    stat(`Beat ${view.turn} / 12`),
    stat(`HP ${view.raider.hp}`),
    stat(`Tools ${view.raider.tools} · ${view.raider.carryingCore ? 'core held' : 'no core'}`),
  );
}

function stat(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function renderList(host, values, fallback) {
  host.replaceChildren();
  if (values.length === 0) {
    const item = document.createElement('li');
    item.textContent = fallback;
    host.append(item);
    return;
  }
  for (const text of values) {
    const item = document.createElement('li');
    item.textContent = text;
    host.append(item);
  }
}

function roleText(view) {
  return `Leg ${view.leg}: Seat ${view.raider.seat} raids; Seat ${view.sentinel.seat} guards`;
}

function renderView(view) {
  state.match.view = view;
  $('#match-status').textContent = `${view.phase.toUpperCase()} · ${roleText(view)}`;
  $('#match-status').classList.remove('quiet');
  renderBoard(view);
  renderList($('#revelations'), view.events.slice(-18).map((item) => `L${item.leg} B${item.turn} — ${item.detail}`), 'No public events yet.');
  renderList($('#legs'), view.completedLegs.map((leg) => `Seat ${leg.raider}: ${leg.extracted ? `extracted in ${leg.usedBeats} beats with ${leg.hpRemaining} HP` : `failed (${leg.reason})`}`), 'None yet.');
  const result = view.result;
  if (result === null) {
    $('#series-outcome').textContent = 'Series active. Both layouts and the full replay remain sealed.';
  } else if (result.status === 'aborted') {
    $('#series-outcome').textContent = `Series aborted (${result.reason}). No winner.`;
  } else {
    $('#series-outcome').textContent = result.winner === null ? `Series complete: draw (${result.reason}).` : `Series complete: Seat ${result.winner} wins (${result.reason}).`;
  }
  $('#load-replay').disabled = view.phase === 'active';
  $('#rematch').disabled = view.phase === 'active' || state.hostToken === null;
  updateManualVisibility();
  if (view.phase !== 'active') closeStream();
}

function storeCreated(data) {
  state.match = { id: data.id, view: data.view };
  state.hostToken = data.hostToken;
  state.tokens = data.tokens;
  state.replay = null;
  state.replayIndex = 0;
  $('#replay-viewer').hidden = true;
  renderView(data.view);
  if (data.view.phase === 'active') openStream();
}

function closeStream() {
  if (state.eventSource !== null) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function openStream() {
  closeStream();
  const source = new EventSource(`/api/matches/${encodeURIComponent(state.match.id)}/stream`);
  source.addEventListener('snapshot', (event) => {
    try {
      const snapshot = JSON.parse(event.data);
      if (snapshot.id === state.match.id) renderView(snapshot.view);
    } catch {
      $('#setup-error').textContent = 'A public stream snapshot could not be parsed.';
    }
  });
  state.eventSource = source;
}

async function startMatch() {
  $('#setup-error').textContent = '';
  const config = buildConfig();
  const overBudget = Object.values(config.layouts).some((layout) => layout.locks.length + layout.traps.length > 4);
  if (overBudget) {
    $('#setup-error').textContent = 'Each fortress has a four-point combined lock/trap budget.';
    return;
  }
  $('#start').disabled = true;
  try {
    const data = await api('/api/matches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) });
    storeCreated(data);
    if (data.view.phase === 'active') await refreshSeat();
  } catch (error) {
    $('#setup-error').textContent = error.message;
  } finally {
    $('#start').disabled = false;
  }
}

async function rematch() {
  if (state.match === null || state.hostToken === null) return;
  $('#setup-error').textContent = '';
  $('#rematch').disabled = true;
  try {
    const data = await api(`/api/matches/${encodeURIComponent(state.match.id)}/rematch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${state.hostToken}` },
      body: JSON.stringify({ config: buildConfig() }),
    });
    storeCreated(data);
  } catch (error) {
    $('#setup-error').textContent = error.message;
    $('#rematch').disabled = false;
  }
}

function updateManualVisibility() {
  if (state.match === null) {
    $('#manual-controls').hidden = true;
    return;
  }
  const entrants = state.match.view.practice.entrants;
  const externalSeats = ['A', 'B'].filter((seat) => entrants[seat] === 'external');
  $('#manual-controls').hidden = state.match.view.phase !== 'active' || externalSeats.length === 0;
  for (const button of $$('.seat-tabs button')) {
    button.disabled = !externalSeats.includes(button.dataset.seat);
    button.classList.toggle('active', button.dataset.seat === state.selectedSeat);
  }
  if (!externalSeats.includes(state.selectedSeat) && externalSeats[0]) state.selectedSeat = externalSeats[0];
}

function describeAction(action) {
  const costs = action.type === 'scan' || action.type === 'breach' ? ' · costs 1 tool' : '';
  return `${action.type}${Object.hasOwn(action, 'target') ? ` ${action.target}` : ''}${costs}`;
}

async function refreshSeat() {
  if (state.match === null || state.match.view.phase !== 'active') return;
  updateManualVisibility();
  const seat = state.selectedSeat;
  const token = state.tokens[seat];
  if (token === null) return;
  try {
    const data = await api(`/api/matches/${encodeURIComponent(state.match.id)}/observe`, { headers: { authorization: `Bearer ${token}` } });
    const view = data.observation;
    const sentinel = view.role === 'raider' ? (view.opponent.position === null ? 'sentinel unknown' : `sentinel at ${view.opponent.position}`) : `raider at ${view.opponent.position}`;
    $('#private-summary').textContent = `Seat ${seat} · ${view.role} · position ${view.own.position} · ${sentinel} · coaching: ${data.coachingNote || '(none)'}`;
    const buttons = data.legalActions.map((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = describeAction(action);
      button.addEventListener('click', () => submitAction(seat, data.leg, data.turn, action));
      return button;
    });
    $('#legal-actions').replaceChildren(...buttons);
  } catch (error) {
    $('#private-summary').textContent = error.message;
    $('#legal-actions').replaceChildren();
  }
}

async function submitAction(seat, leg, turn, action) {
  for (const button of $$('#legal-actions button')) button.disabled = true;
  try {
    state.requestCounter += 1;
    const data = await api(`/api/matches/${encodeURIComponent(state.match.id)}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${state.tokens[seat]}` },
      body: JSON.stringify({ leg, turn, action, requestId: `browser-${seat}-${state.requestCounter}` }),
    });
    renderView(data.view);
    if (data.waiting) {
      const other = seat === 'A' ? 'B' : 'A';
      if (state.match.view.practice.entrants[other] === 'external') state.selectedSeat = other;
    }
    await refreshSeat();
  } catch (error) {
    $('#private-summary').textContent = error.message;
    await refreshSeat();
  }
}

async function loadReplay() {
  if (state.match === null) return;
  try {
    const replay = await api(`/api/matches/${encodeURIComponent(state.match.id)}/replay`, {}, true);
    state.replay = replay;
    state.replayIndex = 0;
    $('#replay-viewer').hidden = false;
    renderReplayStep();
  } catch (error) {
    $('#series-outcome').textContent = error.message;
  }
}

function renderReplayStep() {
  const replay = state.replay;
  if (replay === null) return;
  const total = replay.turns.length;
  if (total === 0) {
    state.replayIndex = 0;
    $('#replay-counter').textContent = 'No resolved beats';
    $('#replay-prev').disabled = true;
    $('#replay-next').disabled = true;
    $('#replay-step').textContent = JSON.stringify({ result: replay.result, abort: replay.abort }, null, 2);
    $('#replay-proof').textContent = `rulesVersion ${replay.rulesVersion} · final SHA-256 ${replay.finalStateHash} · terminal without a tactical result`;
    return;
  }
  state.replayIndex = Math.max(0, Math.min(state.replayIndex, total - 1));
  const turn = replay.turns[state.replayIndex];
  $('#replay-counter').textContent = `Beat ${state.replayIndex + 1} / ${total}`;
  $('#replay-prev').disabled = state.replayIndex === 0;
  $('#replay-next').disabled = state.replayIndex >= total - 1;
  $('#replay-step').textContent = JSON.stringify({ leg: turn.leg, turn: turn.turn, actions: turn.actions, events: turn.events }, null, 2);
  $('#replay-proof').textContent = `rulesVersion ${replay.rulesVersion} · final SHA-256 ${replay.finalStateHash} · both layouts disclosed after terminal series`;
}

function downloadReplay() {
  if (state.replay === null) return;
  const blob = new Blob([`${JSON.stringify(state.replay, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `clank-vault-${state.match.id}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

for (const editor of $$('.layout-editor')) {
  createDefenseChecks(editor, 'locks');
  createDefenseChecks(editor, 'traps');
  editor.querySelector('[data-field="core"]').addEventListener('change', () => { $('#preset').value = 'custom'; });
}

$('#preset').addEventListener('change', (event) => {
  const preset = presets[event.target.value];
  if (!preset) return;
  setLayout($('#layout-a'), preset.A);
  setLayout($('#layout-b'), preset.B);
});
for (const select of ['#mode-a', '#mode-b']) select && $(select).addEventListener('change', updateManualVisibility);
for (const button of $$('.seat-tabs button')) button.addEventListener('click', () => { state.selectedSeat = button.dataset.seat; updateManualVisibility(); void refreshSeat(); });
$('#start').addEventListener('click', startMatch);
$('#rematch').addEventListener('click', rematch);
$('#refresh-seat').addEventListener('click', refreshSeat);
$('#load-replay').addEventListener('click', loadReplay);
$('#replay-prev').addEventListener('click', () => { state.replayIndex -= 1; renderReplayStep(); });
$('#replay-next').addEventListener('click', () => { state.replayIndex += 1; renderReplayStep(); });
$('#download-replay').addEventListener('click', downloadReplay);

setLayout($('#layout-a'), presets.open.A);
setLayout($('#layout-b'), presets.open.B);

api('/api/status').then((data) => {
  $('#server-status').textContent = `${data.process} · ${data.rulesVersion}`;
}).catch((error) => {
  $('#server-status').textContent = 'Referee unavailable';
  $('#setup-error').textContent = error.message;
});
