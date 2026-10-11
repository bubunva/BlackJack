/* ========================================================================== */
/* FELT ROYALE — game client                                                   */
/*                                                                           */
/* Browser-side card games, virtual-chip accounting, profiles, room lobby     */
/* and a PeerJS-hosted peer-to-peer room prototype.                           */
/*                                                                           */
/* Important trust boundary: this is a friendly prototype, not a secure       */
/* gambling service. The room host's browser is authoritative and can be      */
/* modified by a player. Chips have no real-world value.                      */
/* ========================================================================== */

'use strict';

/* -------------------------------------------------------------------------- */
/* Configuration and durable browser state                                     */
/* -------------------------------------------------------------------------- */
const CONFIG = Object.freeze({
  storageKey: 'felt-royale-state-v1',
  startingBalance: 1000,
  minimumBet: 10,
  maximumBet: 500,
  betStep: 10,
  maximumPlayers: 6,
  freeRefillAmount: 500,
  refillThreshold: 100,
  activityLimit: 80,
  roomHistoryLimit: 12,
  peerConnectTimeout: 10000,
  deckSuits: ['♠', '♥', '♦', '♣'],
  deckRanks: [
    { label: '2', value: 2 },
    { label: '3', value: 3 },
    { label: '4', value: 4 },
    { label: '5', value: 5 },
    { label: '6', value: 6 },
    { label: '7', value: 7 },
    { label: '8', value: 8 },
    { label: '9', value: 9 },
    { label: '10', value: 10 },
    { label: 'J', value: 11 },
    { label: 'Q', value: 12 },
    { label: 'K', value: 13 },
    { label: 'A', value: 14 }
  ]
});

const MODE_INFO = Object.freeze({
  blackjack: {
    id: 'blackjack',
    title: 'Blackjack Lounge',
    shortTitle: 'BLACKJACK LOUNGE',
    subtitle: 'Beat the dealer without going over 21.',
    suit: '♦',
    cardsPerPlayer: 2,
    minimumPlayers: 1,
    rules: 'Start with two cards. Hit to draw another card, or stand to keep your total. The dealer draws until reaching at least 17. Number cards count at face value, J/Q/K count as 10, and an ace counts as 1 or 11.',
    tips: ['Reach 21 without going over.', 'A natural blackjack is an ace with a ten-value card.', 'In this friendly demo, a winning round returns twice your bet total.']
  },
  teenpatti: {
    id: 'teenpatti',
    title: 'Teen Patti',
    shortTitle: 'TEEN PATTI',
    subtitle: 'Three cards. One showdown.',
    suit: '♥',
    cardsPerPlayer: 3,
    minimumPlayers: 2,
    rules: 'Every player receives three cards. Compare the strongest category first: trail (three of a kind), pure sequence, sequence, colour (flush), pair, and high card. Ties use card ranks.',
    tips: ['A trail is three cards of the same rank.', 'A pure sequence is consecutive ranks in the same suit.', 'Aces can be high in a sequence or low in A-2-3.']
  },
  highcard: {
    id: 'highcard',
    title: 'High Card Showdown',
    shortTitle: 'HIGH CARD SHOWDOWN',
    subtitle: 'One card decides the round.',
    suit: '♠',
    cardsPerPlayer: 1,
    minimumPlayers: 2,
    rules: 'Each player receives one card. The highest rank wins the pot. An ace is high. If multiple players have the same highest rank, the pot is split evenly.',
    tips: ['Aces rank above kings.', 'A tie for first splits the pot.', 'The quickest mode for a casual rematch.']
  },
  drawpoker: {
    id: 'drawpoker',
    title: 'Five-card Draw',
    shortTitle: 'FIVE-CARD DRAW',
    subtitle: 'Build your strongest five-card hand.',
    suit: '♣',
    cardsPerPlayer: 5,
    minimumPlayers: 2,
    rules: 'Each player receives five cards. This prototype deals and compares complete hands, without a card-exchange phase. Hand categories rank from high card, pair, two pair, three of a kind, straight, flush, full house, four of a kind, through straight flush.',
    tips: ['A flush uses five cards of one suit.', 'A straight is five consecutive ranks.', 'A straight flush beats four of a kind.']
  }
});

const BOT_NAMES = Object.freeze([
  'Mira', 'Ace', 'Rory', 'Kai', 'Nova', 'Remy', 'Sage', 'Cleo', 'Ash', 'Indie',
  'Luca', 'Skye', 'Rumi', 'Theo', 'Pax', 'Nico', 'Ari', 'Juno', 'Eden', 'Milo'
]);

function createDefaultState() {
  return {
    name: 'Joel',
    balance: CONFIG.startingBalance,
    games: 0,
    wins: 0,
    bestStreak: 0,
    currentStreak: 0,
    activity: [],
    rooms: [],
    createdAt: new Date().toISOString()
  };
}

function loadState() {
  const fallback = createDefaultState();
  try {
    const raw = window.localStorage.getItem(CONFIG.storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      ...parsed,
      name: sanitizeDisplayName(parsed.name || fallback.name),
      balance: safeInteger(parsed.balance, fallback.balance, 0, 100000000),
      games: safeInteger(parsed.games, 0, 0, 100000000),
      wins: safeInteger(parsed.wins, 0, 0, 100000000),
      currentStreak: safeInteger(parsed.currentStreak, 0, 0, 1000000),
      bestStreak: safeInteger(parsed.bestStreak, 0, 0, 1000000),
      activity: Array.isArray(parsed.activity) ? parsed.activity.slice(0, CONFIG.activityLimit) : [],
      rooms: Array.isArray(parsed.rooms) ? parsed.rooms.slice(0, CONFIG.roomHistoryLimit) : []
    };
  } catch (error) {
    console.warn('Felt Royale could not read saved browser state.', error);
    return fallback;
  }
}

function saveState() {
  try {
    window.localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
  } catch (error) {
    console.warn('Felt Royale could not save browser state.', error);
    showToast('Your browser blocked local saving. The current session can still be played.', 'error');
  }
}

function safeInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function sanitizeDisplayName(value) {
  const cleaned = String(value || '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
  return cleaned || 'Player';
}

let state = loadState();
let activeView = 'lobby';
let activeMode = 'blackjack';
let localRound = null;
let roomDialogMode = 'create';
let peerRequestInProgress = false;
let lastRecordedRoundId = '';
let toastCounter = 0;

const network = {
  peer: null,
  ownId: '',
  isHost: false,
  hostId: '',
  hostConnection: null,
  connections: new Map(),
  roomPlayers: [],
  roomCode: '',
  roomName: '',
  roomActive: false,
  game: null,
  roomRecordId: ''
};

/* -------------------------------------------------------------------------- */
/* DOM shortcuts and accessibility-friendly helpers                            */
/* -------------------------------------------------------------------------- */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function setText(selector, value) {
  const element = typeof selector === 'string' ? $(selector) : selector;
  if (element) element.textContent = String(value);
}

function showElement(element, visible = true) {
  if (!element) return;
  element.hidden = !visible;
}

function formatNumber(value) {
  return Math.max(0, Number(value) || 0).toLocaleString('en-US');
}

function formatSignedNumber(value) {
  const number = Number(value) || 0;
  if (number > 0) return `+${formatNumber(number)}`;
  if (number < 0) return `−${formatNumber(Math.abs(number))}`;
  return '0';
}

function capitalInitial(value) {
  const text = String(value || 'P').trim();
  return text ? text.charAt(0).toUpperCase() : 'P';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, variant = 'success') {
  const stack = $('#toast-stack');
  if (!stack) return;
  const item = document.createElement('div');
  item.className = `toast-message${variant === 'error' ? ' toast-error' : ''}`;
  item.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  item.dataset.toastId = String(++toastCounter);
  const icon = document.createElement('span');
  icon.className = 'toast-symbol';
  icon.textContent = variant === 'error' ? '!' : '✓';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  item.append(icon, paragraph);
  stack.append(item);
  window.setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(8px)';
    window.setTimeout(() => item.remove(), 240);
  }, 3600);
}

function openDialog(dialog) {
  if (!dialog) return;
  try {
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('modal-open');
  } catch (error) {
    dialog.setAttribute('open', 'open');
    document.body.classList.add('modal-open');
  }
}

function closeDialog(dialog) {
  if (!dialog) return;
  try {
    if (dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  } catch (error) {
    dialog.removeAttribute('open');
  }
  if (!$$('dialog[open]').length) document.body.classList.remove('modal-open');
}

$$('dialog').forEach((dialog) => {
  dialog.addEventListener('close', () => {
    if (!$$('dialog[open]').length) document.body.classList.remove('modal-open');
  });
});

/* -------------------------------------------------------------------------- */
/* Profile, dashboard, activity and local leaderboard                          */
/* -------------------------------------------------------------------------- */
function updateHeader() {
  setText('#header-balance', formatNumber(state.balance));
  setText('#top-name', state.name);
  setText('#top-avatar', capitalInitial(state.name));
  setText('#profile-large-avatar', capitalInitial(state.name));
  setText('#welcome-label', `${state.name.toUpperCase()}'S PRIVATE CARD CLUB`);
  setText('#stat-games', String(state.games).padStart(2, '0'));
  setText('#stat-wins', String(state.wins).padStart(2, '0'));
  setText('#game-balance', `◆ ${formatNumber(state.balance)}`);
  setText('#rank-wins', state.wins);
  setText('#rank-balance', formatNumber(state.balance));
  setText('#profile-games', state.games);
  setText('#profile-wins', state.wins);
  setText('#profile-balance', formatNumber(state.balance));
  $('#player-name-input').value = state.name;
  $('#top-avatar').setAttribute('aria-label', `${state.name}'s profile`);
  updateRoomCounts();
}

function openProfile() {
  updateHeader();
  openDialog($('#profile-modal'));
  window.setTimeout(() => $('#player-name-input')?.focus(), 50);
}

function saveProfile() {
  const field = $('#player-name-input');
  const nextName = sanitizeDisplayName(field ? field.value : state.name);
  const previousName = state.name;
  state.name = nextName;
  saveState();
  updateHeader();
  closeDialog($('#profile-modal'));
  if (network.roomActive && network.peer) {
    sendRoomMessage({ type: 'PROFILE_UPDATE', name: state.name, balance: state.balance });
    if (network.isHost) {
      const mine = network.roomPlayers.find((player) => player.id === network.ownId);
      if (mine) mine.name = state.name;
      broadcastRoomState();
    }
  }
  showToast(previousName === nextName ? 'Player card is up to date.' : `Welcome to the table, ${nextName}.`);
  renderLeaderboard();
  renderRoomList();
}

function switchView(viewName) {
  const validViews = ['lobby', 'tables', 'leaderboard', 'activity', 'howto'];
  const nextView = validViews.includes(viewName) ? viewName : 'lobby';
  activeView = nextView;
  $$('[data-panel]').forEach((panel) => {
    panel.classList.toggle('is-visible', panel.dataset.panel === nextView);
  });
  $$('[data-view]').forEach((button) => {
    const matches = button.dataset.view === nextView;
    button.classList.toggle('is-active', matches);
    if (button.matches('.nav-item')) {
      button.setAttribute('aria-current', matches ? 'page' : 'false');
    }
  });
  if (nextView === 'activity') renderFullActivity();
  if (nextView === 'tables') renderRoomList();
  if (nextView === 'leaderboard') renderLeaderboard();
  if (nextView === 'lobby') renderRecentActivity();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function addActivity(entry) {
  const activityEntry = {
    id: entry.id || `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: entry.mode || activeMode,
    modeTitle: MODE_INFO[entry.mode || activeMode]?.title || 'Card round',
    result: entry.result || 'played',
    delta: Number(entry.delta) || 0,
    balance: state.balance,
    time: new Date().toISOString(),
    note: entry.note || ''
  };
  state.activity.unshift(activityEntry);
  state.activity = state.activity.slice(0, CONFIG.activityLimit);
  saveState();
  renderRecentActivity();
  renderFullActivity();
}

function recordLocalResult(round, result, delta, note = '') {
  if (!round || round.recorded) return;
  round.recorded = true;
  state.games += 1;
  if (result === 'won') {
    state.wins += 1;
    state.currentStreak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.currentStreak);
  } else if (result === 'lost') {
    state.currentStreak = 0;
  }
  addActivity({ id: round.id, mode: round.mode, result, delta, note });
  updateHeader();
  renderLeaderboard();
}

function recordNetworkResult(game, ownPlayer) {
  if (!game || !ownPlayer || !game.resolved) return;
  const roundId = `${game.id}:${network.ownId}`;
  if (lastRecordedRoundId === roundId) return;
  lastRecordedRoundId = roundId;
  state.games += 1;
  if (ownPlayer.result === 'won') {
    state.wins += 1;
    state.currentStreak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.currentStreak);
  } else if (ownPlayer.result === 'lost') {
    state.currentStreak = 0;
  }
  addActivity({
    id: roundId,
    mode: game.mode,
    result: ownPlayer.result || 'played',
    delta: Number(ownPlayer.lastDelta) || 0,
    note: `Private room · ${game.players.length} seats`
  });
  updateHeader();
  renderLeaderboard();
}

function createActivityRow(entry) {
  const row = document.createElement('div');
  row.className = 'activity-row';
  const icon = document.createElement('span');
  icon.className = 'activity-icon';
  icon.textContent = MODE_INFO[entry.mode]?.suit || '♠';
  const copy = document.createElement('span');
  copy.className = 'activity-copy';
  const title = document.createElement('b');
  title.textContent = `${entry.modeTitle || MODE_INFO[entry.mode]?.title || 'Card round'} · ${resultLabel(entry.result)}`;
  const detail = document.createElement('small');
  const timestamp = new Date(entry.time);
  detail.textContent = `${Number.isNaN(timestamp.getTime()) ? 'Saved round' : timestamp.toLocaleString()}${entry.note ? ` · ${entry.note}` : ''}`;
  copy.append(title, detail);
  const result = document.createElement('span');
  result.className = `activity-result${entry.delta < 0 ? ' loss' : ''}`;
  result.textContent = `${entry.delta > 0 ? '+' : ''}${formatNumber(entry.delta)}`;
  row.append(icon, copy, result);
  return row;
}

function resultLabel(result) {
  const labels = {
    won: 'You won',
    lost: 'You lost',
    push: 'Push',
    played: 'Played'
  };
  return labels[result] || 'Played';
}

function renderRecentActivity() {
  const list = $('#recent-activity-list');
  if (!list) return;
  list.replaceChildren();
  if (!state.activity.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-activity';
    empty.innerHTML = '<span class="empty-activity-icon">◷</span><span><b>No rounds yet</b><small>Your game history will show up here.</small></span>';
    list.append(empty);
    return;
  }
  state.activity.slice(0, 3).forEach((entry) => list.append(createActivityRow(entry)));
}

function renderFullActivity() {
  const list = $('#full-activity-list');
  if (!list) return;
  list.replaceChildren();
  if (!state.activity.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<span>◷</span><h3>No sessions recorded</h3><p>Play a practice round or a connected room round, and your history will appear here.</p>';
    list.append(empty);
    return;
  }
  state.activity.forEach((entry) => list.append(createActivityRow(entry)));
}

function renderLeaderboard() {
  const body = $('#leaderboard-body');
  if (!body) return;
  const rows = [{
    name: state.name,
    games: state.games,
    wins: state.wins,
    balance: state.balance,
    isCurrent: true
  }];
  const historicNames = new Map();
  state.activity.forEach((entry) => {
    const name = entry.playerName || '';
    if (!name || name === state.name) return;
    if (!historicNames.has(name)) historicNames.set(name, { name, games: 0, wins: 0, balance: 1000, isCurrent: false });
    const record = historicNames.get(name);
    record.games += 1;
    if (entry.result === 'won') record.wins += 1;
  });
  rows.push(...historicNames.values());
  rows.sort((first, second) => second.wins - first.wins || second.balance - first.balance || second.games - first.games);
  body.replaceChildren();
  rows.slice(0, 12).forEach((player, index) => {
    const row = document.createElement('tr');
    if (player.isCurrent) row.className = 'current-player-row';
    const rank = document.createElement('td');
    rank.className = 'rank-number';
    rank.textContent = `#${String(index + 1).padStart(2, '0')}`;
    const identity = document.createElement('td');
    const identityWrap = document.createElement('span');
    identityWrap.className = 'ranked-player';
    const avatar = document.createElement('span');
    avatar.className = 'ranked-player-avatar';
    avatar.textContent = capitalInitial(player.name);
    const name = document.createElement('span');
    name.textContent = player.isCurrent ? `${player.name} (you)` : player.name;
    identityWrap.append(avatar, name);
    identity.append(identityWrap);
    const games = document.createElement('td');
    games.textContent = player.games;
    const wins = document.createElement('td');
    wins.textContent = player.wins;
    const rate = document.createElement('td');
    rate.className = 'win-rate';
    rate.textContent = `${player.games ? Math.round((player.wins / player.games) * 100) : 0}%`;
    const balance = document.createElement('td');
    balance.textContent = formatNumber(player.balance);
    row.append(rank, identity, games, wins, rate, balance);
    body.append(row);
  });
  setText('#your-rank', '#01');
}

/* -------------------------------------------------------------------------- */
/* Private-room dialog and room list                                           */
/* -------------------------------------------------------------------------- */
function openRoomDialog(mode = 'create') {
  roomDialogMode = mode;
  const roomModal = $('#room-modal');
  showElement($('#room-code-panel'), Boolean(network.roomActive && network.isHost));
  showElement($('#join-code-wrap'), mode === 'join');
  $('#room-modal-title').innerHTML = mode === 'join' ? 'Join your <em>crew.</em>' : 'Bring your <em>crew.</em>';
  $('#room-modal-copy').textContent = mode === 'join'
    ? 'Paste the room code shared by the host. Room codes are PeerJS IDs, not passwords.'
    : 'Create a private room and share the code with your friends. One room has a maximum of six players.';
  setText('#room-primary-action', mode === 'join' ? 'Join private room ↗' : (network.roomActive && network.isHost ? 'Room is ready ✓' : 'Create room ↗'));
  setText('#switch-room-mode', mode === 'join' ? 'Want to host instead? Create a room' : 'Have a code already? Join a room');
  if (network.roomActive && network.isHost) {
    showElement($('#room-code-panel'), true);
    setText('#room-code-value', network.roomCode);
    setText('#room-connection-status', `${network.roomPlayers.length} of ${CONFIG.maximumPlayers} seats occupied · Keep this tab open.`);
  }
  openDialog(roomModal);
}

function switchRoomDialogMode() {
  openRoomDialog(roomDialogMode === 'join' ? 'create' : 'join');
}

function createPrivateRoom() {
  if (peerRequestInProgress) return;
  if (typeof window.Peer !== 'function') {
    showToast('PeerJS did not load. Check your internet connection, then refresh this page.', 'error');
    return;
  }
  teardownNetwork(false);
  const nameField = $('#room-name-input');
  network.roomName = sanitizeRoomName(nameField ? nameField.value : 'Friday Night Table');
  peerRequestInProgress = true;
  setText('#room-primary-action', 'Connecting…');
  setText('#room-connection-status', 'Contacting the public PeerJS signaling service…');
  showElement($('#room-code-panel'), true);
  setText('#room-code-value', 'CONNECTING');
  try {
    const peer = new Peer(undefined, { debug: 0 });
    network.peer = peer;
    network.isHost = true;
    network.roomActive = false;
    peer.on('open', (id) => {
      peerRequestInProgress = false;
      network.ownId = id;
      network.hostId = id;
      network.roomCode = id;
      network.roomActive = true;
      network.roomRecordId = `room-${id}`;
      network.roomPlayers = [{ id, name: state.name, balance: state.balance, host: true, connected: true }];
      const roomRecord = {
        id: network.roomRecordId,
        code: id,
        name: network.roomName,
        hostName: state.name,
        createdAt: new Date().toISOString(),
        lastKnownSeats: 1,
        status: 'hosting'
      };
      state.rooms = [roomRecord, ...state.rooms.filter((room) => room.id !== roomRecord.id)].slice(0, CONFIG.roomHistoryLimit);
      saveState();
      setText('#room-code-value', id);
      setText('#room-connection-status', 'Room ready. Share this code; leave this tab open while friends play.');
      setText('#room-primary-action', 'Room is ready ✓');
      updateHeader();
      renderRoomList();
      broadcastRoomState();
      showToast('Private room created. Share the room code with your friends.');
    });
    peer.on('connection', handleIncomingConnection);
    peer.on('error', handlePeerError);
    peer.on('disconnected', () => {
      setText('#room-connection-status', 'Signaling disconnected. Try reconnecting before inviting friends.');
    });
    peer.on('close', () => {
      if (network.isHost) {
        network.roomActive = false;
        updateRoomCounts();
      }
    });
  } catch (error) {
    peerRequestInProgress = false;
    setText('#room-connection-status', 'Could not create the room. Check whether PeerJS is available.');
    showToast('Room setup failed. You can still play local practice rounds.', 'error');
  }
}

function sanitizeRoomName(value) {
  const cleaned = String(value || 'Friends Table')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);
  return cleaned || 'Friends Table';
}

function joinPrivateRoom() {
  if (peerRequestInProgress) return;
  if (typeof window.Peer !== 'function') {
    showToast('PeerJS did not load. Check your internet connection, then refresh this page.', 'error');
    return;
  }
  const code = String($('#join-code-input').value || '').trim();
  if (code.length < 5 || code.length > 80 || /\s/.test(code)) {
    showToast('Enter the room code exactly as the host shared it.', 'error');
    $('#join-code-input').focus();
    return;
  }
  teardownNetwork(false);
  peerRequestInProgress = true;
  setText('#room-primary-action', 'Connecting…');
  try {
    const peer = new Peer(undefined, { debug: 0 });
    network.peer = peer;
    network.isHost = false;
    peer.on('open', (id) => {
      network.ownId = id;
      network.hostId = code;
      network.roomCode = code;
      const connection = peer.connect(code, { reliable: true, serialization: 'json' });
      network.hostConnection = connection;
      connection.on('open', () => {
        peerRequestInProgress = false;
        network.roomActive = true;
        connection.send({ type: 'JOIN', name: state.name, balance: state.balance, version: 1 });
        setText('#room-connection-status', 'Connected to the host. Waiting for the room list…');
        setText('#room-primary-action', 'Connecting to table…');
      });
      connection.on('data', handleClientMessage);
      connection.on('close', () => {
        network.roomActive = false;
        showToast('The host connection closed. Your local practice tables are still available.', 'error');
        updateRoomCounts();
      });
      connection.on('error', () => {
        peerRequestInProgress = false;
        showToast('Could not connect to that room. Check the code and try again.', 'error');
        setText('#room-connection-status', 'Connection failed. Check the room code and try again.');
        setText('#room-primary-action', 'Try joining again ↗');
      });
    });
    peer.on('error', handlePeerError);
  } catch (error) {
    peerRequestInProgress = false;
    showToast('Room connection failed. Local practice still works.', 'error');
  }
}

function handlePeerError(error) {
  peerRequestInProgress = false;
  const message = String(error && error.type ? error.type : 'connection error');
  console.warn('PeerJS room error:', error);
  if (message === 'peer-unavailable') {
    showToast('That room is not reachable. The host may have closed their tab.', 'error');
  } else if (message === 'network' || message === 'server-error') {
    showToast('The room signaling service is unavailable. Try again in a moment.', 'error');
  } else {
    showToast('Private-room setup hit a connection issue. Try again or use local practice.', 'error');
  }
  setText('#room-connection-status', 'Connection issue. Check internet access and try again.');
  setText('#room-primary-action', roomDialogMode === 'join' ? 'Try joining again ↗' : 'Try creating again ↗');
}

function handleIncomingConnection(connection) {
  connection.on('data', (message) => handleHostMessage(connection, message));
  connection.on('close', () => {
    const player = network.roomPlayers.find((entry) => entry.id === connection.peer);
    network.connections.delete(connection.peer);
    network.roomPlayers = network.roomPlayers.filter((entry) => entry.id !== connection.peer);
    if (network.game && !network.game.resolved) {
      const participant = network.game.players.find((entry) => entry.id === connection.peer);
      if (participant && participant.status === 'playing') participant.status = 'left';
      if (network.game.mode === 'blackjack') maybeFinishOnlineBlackjack();
      else maybeResolveOnlineCompetition();
    }
    broadcastRoomState();
    broadcastOnlineGame();
    if (player) showToast(`${player.name} left the room.`);
    updateRoomCounts();
  });
  connection.on('error', () => {
    showToast('A friend connection dropped. Ask them to rejoin using the same room code.', 'error');
  });
}

function handleHostMessage(connection, message) {
  if (!message || typeof message !== 'object') return;
  const id = connection.peer;
  if (message.type === 'JOIN') {
    if (network.roomPlayers.length >= CONFIG.maximumPlayers) {
      connection.send({ type: 'ROOM_FULL', maximum: CONFIG.maximumPlayers });
      connection.close();
      return;
    }
    const player = {
      id,
      name: sanitizeDisplayName(message.name),
      balance: safeInteger(message.balance, CONFIG.startingBalance, 0, 100000000),
      host: false,
      connected: true
    };
    network.connections.set(id, connection);
    network.roomPlayers = network.roomPlayers.filter((entry) => entry.id !== id);
    network.roomPlayers.push(player);
    connection.send({ type: 'WELCOME', hostId: network.ownId, roomCode: network.roomCode, roomName: network.roomName });
    broadcastRoomState();
    broadcastOnlineGameToOne(id);
    showToast(`${player.name} joined the table.`);
    return;
  }
  if (message.type === 'PROFILE_UPDATE') {
    const player = network.roomPlayers.find((entry) => entry.id === id);
    if (player) {
      player.name = sanitizeDisplayName(message.name);
      player.balance = safeInteger(message.balance, player.balance, 0, 100000000);
      if (network.game) {
        const gamePlayer = network.game.players.find((entry) => entry.id === id);
        if (gamePlayer) gamePlayer.name = player.name;
      }
      broadcastRoomState();
      broadcastOnlineGame();
    }
    return;
  }
  if (message.type === 'START_REQUEST') {
    if (network.game && !network.game.resolved) {
      connection.send({ type: 'NOTICE', message: 'A round is already in progress.' });
      return;
    }
    hostStartOnlineRound(message.mode, message.bet);
    return;
  }
  if (message.type === 'ACTION') {
    handleOnlineAction(id, message.action);
    return;
  }
  if (message.type === 'PING') {
    connection.send({ type: 'PONG', at: Date.now() });
  }
}

function handleClientMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'WELCOME') {
    network.roomName = sanitizeRoomName(message.roomName || 'Private table');
    setText('#room-connection-status', `Connected to ${network.roomName}. Waiting for the player list…`);
    setText('#room-primary-action', 'Connected ✓');
    showToast(`Connected to ${network.roomName}.`);
  }
  if (message.type === 'ROOM_STATE') {
    network.roomActive = true;
    network.roomPlayers = Array.isArray(message.players) ? message.players : [];
    network.roomName = sanitizeRoomName(message.roomName || network.roomName || 'Private table');
    network.roomCode = message.roomCode || network.roomCode;
    network.hostId = message.hostId || network.hostId;
    setText('#room-code-value', network.roomCode);
    setText('#room-connection-status', `${network.roomPlayers.length} of ${CONFIG.maximumPlayers} seats occupied · Share the code with friends.`);
    setText('#room-primary-action', 'Connected ✓');
    updateRoomCounts();
    renderRoomList();
    if (!network.isHost) {
      closeDialog($('#room-modal'));
      openDialog($('#game-modal'));
      setupTableShell(activeMode, true);
      renderRoomPreview();
    }
    if (activeMode && $('#game-modal').open && !network.game) {
      setText('#game-room-label', 'PRIVATE ROOM');
    }
  }
  if (message.type === 'ROOM_FULL') {
    network.roomActive = false;
    showToast(`This room is full. The limit is ${message.maximum || CONFIG.maximumPlayers} players.`, 'error');
    setText('#room-connection-status', 'This room is full. Ask the host to free a seat.');
  }
  if (message.type === 'NOTICE') showToast(message.message || 'Room message.');
  if (message.type === 'GAME_STATE') {
    network.game = message.game;
    const own = network.game?.players?.find((player) => player.id === network.ownId);
    if (own && Number.isFinite(own.balance)) {
      state.balance = own.balance;
      saveState();
      updateHeader();
    }
    renderOnlineTable();
    if (network.game?.resolved && own) recordNetworkResult(network.game, own);
  }
  if (message.type === 'ROOM_CLOSED') {
    showToast('The host closed the private room.', 'error');
    teardownNetwork(false);
  }
}

function sendRoomMessage(message) {
  if (network.isHost) {
    network.connections.forEach((connection) => {
      try { connection.send(message); } catch (error) { console.warn('Could not send room message.', error); }
    });
  } else if (network.hostConnection && network.hostConnection.open) {
    try { network.hostConnection.send(message); } catch (error) { console.warn('Could not send host message.', error); }
  }
}

function makeRoomStatePayload() {
  return {
    type: 'ROOM_STATE',
    roomName: network.roomName,
    roomCode: network.roomCode,
    hostId: network.ownId,
    maximum: CONFIG.maximumPlayers,
    players: network.roomPlayers.map((player) => ({
      id: player.id,
      name: player.name,
      balance: player.balance,
      host: Boolean(player.host),
      connected: player.connected !== false
    }))
  };
}

function broadcastRoomState() {
  if (!network.isHost) return;
  const payload = makeRoomStatePayload();
  network.connections.forEach((connection) => {
    try { connection.send(payload); } catch (error) { console.warn('Room list broadcast failed.', error); }
  });
  if (network.game) broadcastOnlineGame();
  const localRecord = state.rooms.find((room) => room.id === network.roomRecordId);
  if (localRecord) {
    localRecord.lastKnownSeats = network.roomPlayers.length;
    localRecord.status = 'hosting';
    saveState();
  }
  updateRoomCounts();
}

function updateRoomCounts() {
  const count = network.roomActive ? network.roomPlayers.length : 0;
  setText('#nav-table-count', count);
  setText('#sidebar-room-count', count);
  const slots = $$('.invite-slots .slot-filled, .invite-slots .slot-empty');
  const displayedSeatCount = network.roomActive ? network.roomPlayers.length : 1;
  if (slots.length) {
    slots.forEach((slot, index) => {
      if (index < displayedSeatCount) {
        slot.classList.remove('slot-empty');
        slot.classList.add('slot-filled');
        const player = network.roomActive ? network.roomPlayers[index] : null;
        slot.textContent = capitalInitial(player ? player.name : state.name);
      } else {
        slot.classList.remove('slot-filled');
        slot.classList.add('slot-empty');
        slot.textContent = '＋';
      }
    });
    const label = $('.invite-slots-label');
    if (label) label.textContent = displayedSeatCount + ' of ' + CONFIG.maximumPlayers + ' seats occupied';
  }
}

function renderRoomList() {
  const grid = $('#room-grid');
  if (!grid) return;
  const filter = String($('#room-search')?.value || '').toLowerCase();
  const records = [...state.rooms];
  if (network.roomActive && network.roomRecordId && !records.some((room) => room.id === network.roomRecordId)) {
    records.unshift({ id: network.roomRecordId, code: network.roomCode, name: network.roomName || 'Private table', hostName: state.name, lastKnownSeats: network.roomPlayers.length, status: network.isHost ? 'hosting' : 'connected' });
  }
  const visible = records.filter((room) => `${room.name || ''} ${room.code || ''}`.toLowerCase().includes(filter));
  grid.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<span>▦</span><h3>No tables yet</h3><p>Create a private room for up to six players and invite your friends.</p><button class="button button-gold" id="empty-create-room">Create your first room</button>';
    grid.append(empty);
    $('#empty-create-room')?.addEventListener('click', () => openRoomDialog('create'));
    return;
  }
  visible.forEach((room) => {
    const tile = document.createElement('article');
    tile.className = 'room-tile';
    const header = document.createElement('div');
    header.className = 'room-tile-header';
    const icon = document.createElement('div');
    icon.className = 'room-tile-icon';
    icon.textContent = '♠';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'room-tile-title';
    const title = document.createElement('h3');
    title.textContent = room.name || 'Private table';
    const owner = document.createElement('p');
    owner.textContent = `Hosted by ${room.hostName || state.name}`;
    titleWrap.append(title, owner);
    const status = document.createElement('span');
    status.className = 'room-status-tag';
    status.textContent = room.id === network.roomRecordId && network.roomActive ? (network.isHost ? 'HOSTING' : 'CONNECTED') : 'SAVED';
    header.append(icon, titleWrap, status);
    const details = document.createElement('div');
    details.className = 'room-tile-details';
    const codeLabel = document.createElement('span');
    codeLabel.textContent = `CODE · ${room.code || 'Not available'}`;
    const seatsWrap = document.createElement('span');
    seatsWrap.className = 'room-seats';
    const seats = room.id === network.roomRecordId && network.roomActive ? network.roomPlayers.length : (room.lastKnownSeats || 1);
    for (let index = 0; index < CONFIG.maximumPlayers; index += 1) {
      const dot = document.createElement('span');
      dot.className = `room-seat-dot${index < seats ? ' occupied' : ''}`;
      seatsWrap.append(dot);
    }
    details.append(codeLabel, seatsWrap);
    const actions = document.createElement('div');
    actions.className = 'room-tile-actions';
    const joinButton = document.createElement('button');
    joinButton.className = 'button button-dark-gold';
    joinButton.textContent = room.id === network.roomRecordId && network.roomActive ? 'Open room' : 'Join with code';
    joinButton.addEventListener('click', () => {
      if (room.id === network.roomRecordId && network.roomActive) {
        closeDialog($('#room-modal'));
        if (network.game) {
          openDialog($('#game-modal'));
          renderOnlineTable();
        } else {
          openRoomDialog(network.isHost ? 'create' : 'join');
        }
      } else {
        $('#join-code-input').value = room.code || '';
        openRoomDialog('join');
      }
    });
    const copyButton = document.createElement('button');
    copyButton.className = 'button button-dark-outline';
    copyButton.textContent = 'Copy code';
    copyButton.addEventListener('click', () => copyText(room.code || '', 'Room code copied.'));
    actions.append(joinButton, copyButton);
    tile.append(header, details, actions);
    grid.append(tile);
  });
}

function copyText(text, successMessage) {
  if (!text) {
    showToast('There is no room code to copy yet.', 'error');
    return;
  }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showToast(successMessage)).catch(() => fallbackCopy(text, successMessage));
  } else {
    fallbackCopy(text, successMessage);
  }
}

function fallbackCopy(text, successMessage) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
  area.remove();
  showToast(copied ? successMessage : `Copy this code manually: ${text}`, copied ? 'success' : 'error');
}

function teardownNetwork(notifyPeers = true) {
  if (notifyPeers && network.isHost) {
    sendRoomMessage({ type: 'ROOM_CLOSED' });
  }
  network.connections.forEach((connection) => {
    try { connection.close(); } catch (error) { /* Best-effort cleanup. */ }
  });
  network.connections.clear();
  try { network.hostConnection?.close(); } catch (error) { /* Best-effort cleanup. */ }
  try { network.peer?.destroy(); } catch (error) { /* Best-effort cleanup. */ }
  network.peer = null;
  network.ownId = '';
  network.isHost = false;
  network.hostId = '';
  network.hostConnection = null;
  network.connections = new Map();
  network.roomPlayers = [];
  network.roomCode = '';
  network.roomName = '';
  network.roomActive = false;
  network.game = null;
  network.roomRecordId = '';
  peerRequestInProgress = false;
  updateRoomCounts();
  renderRoomList();
}

/* -------------------------------------------------------------------------- */
/* Deck creation, shuffling and card-value helpers                              */
/* -------------------------------------------------------------------------- */
function createDeck() {
  const deck = [];
  CONFIG.deckSuits.forEach((suit) => {
    CONFIG.deckRanks.forEach((rank) => {
      deck.push({
        id: `${rank.label}${suit}`,
        rank: rank.label,
        value: rank.value,
        suit,
        color: suit === '♥' || suit === '♦' ? 'red' : 'black'
      });
    });
  });
  return shuffleDeck(deck);
}

function shuffleDeck(deck) {
  const cards = [...deck];
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
  return cards;
}

function drawCard(deck) {
  if (!deck.length) throw new Error('The deck is empty.');
  return deck.pop();
}

function cardLabel(card) {
  return `${card.rank}${card.suit}`;
}

function sortCardsHighToLow(cards) {
  return [...cards].sort((first, second) => second.value - first.value);
}

function sumCardValues(cards, useBlackjackValues = false) {
  if (!useBlackjackValues) return cards.reduce((total, card) => total + card.value, 0);
  let total = 0;
  let aces = 0;
  cards.forEach((card) => {
    if (card.rank === 'A') {
      total += 11;
      aces += 1;
    } else {
      total += Math.min(card.value, 10);
    }
  });
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function blackjackHandLabel(cards) {
  const total = sumCardValues(cards, true);
  if (total > 21) return `Bust · ${total}`;
  if (cards.length === 2 && total === 21) return 'Blackjack · 21';
  return `Total · ${total}`;
}

function rankValue(card) {
  return card.rank === 'A' ? 14 : card.value;
}

/* -------------------------------------------------------------------------- */
/* Teen Patti hand evaluator                                                    */
/* -------------------------------------------------------------------------- */
function evaluateTeenPatti(cards) {
  const sorted = sortCardsHighToLow(cards);
  const values = sorted.map(rankValue);
  const counts = countRanks(sorted);
  const sameSuit = sorted.every((card) => card.suit === sorted[0].suit);
  const sequenceInfo = getSequenceInfo(values);
  const countEntries = [...counts.entries()].sort((first, second) => second[1] - first[1] || second[0] - first[0]);
  let category = 1;
  let label = 'High card';
  let tie = values;
  if (countEntries[0][1] === 3) {
    category = 6;
    label = 'Trail';
    tie = [countEntries[0][0]];
  } else if (sameSuit && sequenceInfo.isSequence) {
    category = 5;
    label = 'Pure sequence';
    tie = [sequenceInfo.high];
  } else if (sequenceInfo.isSequence) {
    category = 4;
    label = 'Sequence';
    tie = [sequenceInfo.high];
  } else if (sameSuit) {
    category = 3;
    label = 'Colour';
    tie = values;
  } else if (countEntries[0][1] === 2) {
    category = 2;
    label = 'Pair';
    const pairValue = countEntries[0][0];
    const kicker = values.find((value) => value !== pairValue) || 0;
    tie = [pairValue, kicker];
  }
  return { category, label, tie, score: encodeScore(category, tie) };
}

function countRanks(cards) {
  const counts = new Map();
  cards.forEach((card) => counts.set(rankValue(card), (counts.get(rankValue(card)) || 0) + 1));
  return counts;
}

function getSequenceInfo(values) {
  const uniqueValues = [...new Set(values)].sort((first, second) => second - first);
  if (uniqueValues.length !== 3) return { isSequence: false, high: uniqueValues[0] || 0 };
  if (uniqueValues[0] - uniqueValues[2] === 2) return { isSequence: true, high: uniqueValues[0] };
  if (uniqueValues[0] === 14 && uniqueValues[1] === 3 && uniqueValues[2] === 2) return { isSequence: true, high: 3 };
  return { isSequence: false, high: uniqueValues[0] };
}

/* -------------------------------------------------------------------------- */
/* Five-card poker evaluator                                                    */
/* -------------------------------------------------------------------------- */
function evaluatePokerHand(cards) {
  const sorted = sortCardsHighToLow(cards);
  const values = sorted.map(rankValue).sort((first, second) => second - first);
  const counts = countRanks(sorted);
  const groups = [...counts.entries()].sort((first, second) => second[1] - first[1] || second[0] - first[0]);
  const flush = sorted.every((card) => card.suit === sorted[0].suit);
  const straightInfo = getFiveCardStraight(values);
  let category = 0;
  let label = 'High card';
  let tie = [...values];
  if (flush && straightInfo.isStraight) {
    category = 8;
    label = straightInfo.high === 14 ? 'Royal flush' : 'Straight flush';
    tie = [straightInfo.high];
  } else if (groups[0][1] === 4) {
    category = 7;
    label = 'Four of a kind';
    tie = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1]?.[1] === 2) {
    category = 6;
    label = 'Full house';
    tie = [groups[0][0], groups[1][0]];
  } else if (flush) {
    category = 5;
    label = 'Flush';
    tie = values;
  } else if (straightInfo.isStraight) {
    category = 4;
    label = 'Straight';
    tie = [straightInfo.high];
  } else if (groups[0][1] === 3) {
    category = 3;
    label = 'Three of a kind';
    tie = [groups[0][0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)];
  } else if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    category = 2;
    label = 'Two pair';
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    tie = [...pairs, groups[2][0]];
  } else if (groups[0][1] === 2) {
    category = 1;
    label = 'Pair';
    tie = [groups[0][0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)];
  }
  return { category, label, tie, score: encodeScore(category, tie) };
}

function getFiveCardStraight(values) {
  const unique = [...new Set(values)].sort((first, second) => second - first);
  if (unique.length !== 5) return { isStraight: false, high: unique[0] || 0 };
  if (unique[0] - unique[4] === 4) return { isStraight: true, high: unique[0] };
  if (unique[0] === 14 && unique[1] === 5 && unique[2] === 4 && unique[3] === 3 && unique[4] === 2) {
    return { isStraight: true, high: 5 };
  }
  return { isStraight: false, high: unique[0] };
}

function encodeScore(category, tieBreakers) {
  let score = category;
  tieBreakers.forEach((value) => {
    score = score * 15 + Math.max(0, Math.min(14, value));
  });
  return score;
}

function compareScores(first, second) {
  if (first.score !== second.score) return first.score > second.score ? 1 : -1;
  const length = Math.max(first.tie.length, second.tie.length);
  for (let index = 0; index < length; index += 1) {
    const firstValue = first.tie[index] || 0;
    const secondValue = second.tie[index] || 0;
    if (firstValue !== secondValue) return firstValue > secondValue ? 1 : -1;
  }
  return 0;
}

function evaluateHandForMode(mode, cards) {
  if (mode === 'highcard') {
    const card = cards[0];
    return { category: 1, label: `${card.rank} high`, tie: [rankValue(card)], score: rankValue(card) };
  }
  if (mode === 'teenpatti') return evaluateTeenPatti(cards);
  if (mode === 'drawpoker') return evaluatePokerHand(cards);
  return { category: 0, label: blackjackHandLabel(cards), tie: [sumCardValues(cards, true)], score: sumCardValues(cards, true) };
}

/* -------------------------------------------------------------------------- */
/* Local practice games                                                        */
/* -------------------------------------------------------------------------- */
function launchGame(mode) {
  if (!MODE_INFO[mode]) {
    showToast('That game mode is not available.', 'error');
    return;
  }
  activeMode = mode;
  localRound = null;
  $('#bet-amount').value = String(Math.min(500, Math.max(10, safeInteger($('#bet-amount').value, 25, 10, 500))));
  if (network.roomActive) {
    if (network.game && !network.game.resolved) {
      openDialog($('#game-modal'));
      renderOnlineTable();
      showToast('A connected room round is already underway.');
      return;
    }
    openDialog($('#game-modal'));
    setText('#game-room-label', network.isHost ? 'HOSTED PRIVATE ROOM' : 'CONNECTED PRIVATE ROOM');
    hostOrRequestOnlineRound(mode);
    return;
  }
  openDialog($('#game-modal'));
  setText('#game-room-label', 'PRACTICE TABLE');
  setupTableShell(mode, false);
  renderLocalTable();
}

function setupTableShell(mode, online) {
  activeMode = mode;
  const info = MODE_INFO[mode];
  setText('#game-mode-label', info.shortTitle);
  $('#game-modal-title').innerHTML = `${escapeHtml(info.title.split(' ')[0])} <em>${escapeHtml(info.title.split(' ').slice(1).join(' ') || 'table')}.</em>`;
  setText('#felt-table-name', 'FELT ROYALE');
  setText('#felt-table-caption', online ? 'PRIVATE ROOM · CONNECTED PLAYERS' : 'FRIENDS · CARDS · GOOD TIMES');
  setText('#game-round-caption', online ? 'PRIVATE ROOM · WAITING FOR DEAL' : 'PRACTICE ROUND · VIRTUAL CHIPS');
  setText('#game-status-text', online ? 'Connected room ready. Start a round to deal cards.' : 'Your table is ready. Choose your bet and deal in.');
  setText('#game-pot', '◆ 0');
  renderActionButtons('ready');
  updateHeader();
}

function readBet() {
  const field = $('#bet-amount');
  const desired = safeInteger(field ? field.value : 25, 25, CONFIG.minimumBet, CONFIG.maximumBet);
  const rounded = Math.max(CONFIG.minimumBet, Math.min(CONFIG.maximumBet, Math.round(desired / CONFIG.betStep) * CONFIG.betStep));
  if (field) field.value = String(rounded);
  return rounded;
}

function dealLocalRound() {
  if (network.roomActive) {
    hostOrRequestOnlineRound(activeMode);
    return;
  }
  const bet = readBet();
  if (state.balance < bet) {
    showToast('You do not have enough virtual chips for that bet. Use the free refill if needed.', 'error');
    return;
  }
  state.balance -= bet;
  const deck = createDeck();
  const round = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    mode: activeMode,
    bet,
    pot: bet,
    deck,
    player: { id: 'local-player', name: state.name, hand: [], status: 'playing', result: 'playing' },
    opponents: [],
    dealerHand: [],
    phase: 'playing',
    result: null,
    payout: 0,
    recorded: false,
    startingBalance: state.balance + bet
  };
  localRound = round;
  const desiredOpponents = activeMode === 'blackjack' ? 1 : Math.max(1, Math.min(5, CONFIG.maximumPlayers - 1));
  for (let index = 0; index < desiredOpponents; index += 1) {
    const botName = BOT_NAMES[(Math.floor(Math.random() * BOT_NAMES.length) + index) % BOT_NAMES.length];
    round.opponents.push({ id: `bot-${index}`, name: botName, hand: [], status: 'playing', result: 'playing' });
  }
  if (activeMode === 'blackjack') {
    round.player.hand = [drawCard(deck), drawCard(deck)];
    round.dealerHand = [drawCard(deck), drawCard(deck)];
    round.pot = bet;
    const playerTotal = sumCardValues(round.player.hand, true);
    if (playerTotal === 21) {
      settleLocalBlackjack(true);
    }
  } else {
    const cardsPerHand = MODE_INFO[activeMode].cardsPerPlayer;
    round.player.hand = Array.from({ length: cardsPerHand }, () => drawCard(deck));
    round.opponents.forEach((opponent) => {
      opponent.hand = Array.from({ length: cardsPerHand }, () => drawCard(deck));
    });
    round.pot = bet * (round.opponents.length + 1);
  }
  saveState();
  updateHeader();
  renderLocalTable();
  if (activeMode === 'blackjack') {
    if (round.phase !== 'resolved') {
      setText('#game-status-text', `Your total is ${sumCardValues(round.player.hand, true)}. Hit or stand.`);
    }
  } else {
    setText('#game-status-text', 'Cards are dealt. Reveal your hand when you are ready for the showdown.');
  }
}

function localBlackjackHit() {
  if (!localRound || localRound.mode !== 'blackjack' || localRound.phase !== 'playing') return;
  localRound.player.hand.push(drawCard(localRound.deck));
  const total = sumCardValues(localRound.player.hand, true);
  if (total > 21) {
    localRound.phase = 'resolved';
    localRound.player.status = 'bust';
    localRound.result = 'lost';
    localRound.payout = 0;
    recordLocalResult(localRound, 'lost', -localRound.bet, `Bust at ${total}`);
    setText('#game-status-text', `Bust at ${total}. The dealer takes this round.`);
  } else {
    setText('#game-status-text', `Your total is ${total}. Hit or stand.`);
  }
  renderLocalTable();
  updateHeader();
}

function localBlackjackStand() {
  if (!localRound || localRound.mode !== 'blackjack' || localRound.phase !== 'playing') return;
  while (sumCardValues(localRound.dealerHand, true) < 17) {
    localRound.dealerHand.push(drawCard(localRound.deck));
  }
  const playerTotal = sumCardValues(localRound.player.hand, true);
  const dealerTotal = sumCardValues(localRound.dealerHand, true);
  let result = 'lost';
  let message = `Dealer has ${dealerTotal}. You have ${playerTotal}.`;
  if (dealerTotal > 21 || playerTotal > dealerTotal) {
    result = 'won';
    localRound.payout = localRound.bet * 2;
    state.balance += localRound.payout;
    message += ' You win the round.';
  } else if (playerTotal === dealerTotal) {
    result = 'push';
    localRound.payout = localRound.bet;
    state.balance += localRound.bet;
    message += ' Push — your bet is returned.';
  } else {
    localRound.payout = 0;
    message += ' The dealer wins this round.';
  }
  localRound.phase = 'resolved';
  localRound.player.status = result;
  localRound.result = result;
  recordLocalResult(localRound, result, localRound.payout - localRound.bet, message);
  setText('#game-status-text', message);
  updateHeader();
  renderLocalTable();
}

function settleLocalBlackjack(natural = false) {
  if (!localRound || localRound.mode !== 'blackjack' || localRound.phase === 'resolved') return;
  const playerTotal = sumCardValues(localRound.player.hand, true);
  const dealerTotal = sumCardValues(localRound.dealerHand, true);
  let result = 'lost';
  let payout = 0;
  let message = '';
  if (playerTotal === 21 && dealerTotal !== 21) {
    result = 'won';
    payout = natural ? Math.round(localRound.bet * 2.5) : localRound.bet * 2;
    state.balance += payout;
    message = natural ? 'Blackjack! Natural 21 wins this round.' : 'You win the round.';
  } else if (playerTotal === 21 && dealerTotal === 21) {
    result = 'push';
    payout = localRound.bet;
    state.balance += payout;
    message = 'Both sides have blackjack. Your bet is returned.';
  } else {
    result = 'lost';
    message = `Dealer has ${dealerTotal}. The dealer wins this round.`;
  }
  localRound.phase = 'resolved';
  localRound.player.status = result;
  localRound.result = result;
  localRound.payout = payout;
  recordLocalResult(localRound, result, payout - localRound.bet, message);
  setText('#game-status-text', message);
  updateHeader();
  renderLocalTable();
}

function localShowdown() {
  if (!localRound || localRound.phase === 'resolved' || localRound.mode === 'blackjack') return;
  const allPlayers = [localRound.player, ...localRound.opponents];
  const ranked = allPlayers.map((player) => ({ player, hand: evaluateHandForMode(localRound.mode, player.hand) }));
  ranked.sort((first, second) => compareScores(second.hand, first.hand));
  const best = ranked[0].hand;
  const winners = ranked.filter((entry) => compareScores(entry.hand, best) === 0);
  const playerIsWinner = winners.some((entry) => entry.player.id === localRound.player.id);
  const tied = winners.length > 1;
  let result = playerIsWinner ? (tied ? 'push' : 'won') : 'lost';
  let payout = 0;
  let message;
  if (playerIsWinner && !tied) {
    payout = localRound.bet * 2;
    state.balance += payout;
    message = `You win with ${evaluateHandForMode(localRound.mode, localRound.player.hand).label}.`;
  } else if (playerIsWinner && tied) {
    payout = localRound.bet;
    state.balance += payout;
    message = `Tie for the best hand (${best.label}). Your bet is returned.`;
  } else {
    const winnerNames = winners.map((entry) => entry.player.name).join(', ');
    message = `${winnerNames} win with ${best.label}. Better luck on the next round.`;
  }
  localRound.phase = 'resolved';
  localRound.player.status = result;
  localRound.result = result;
  localRound.payout = payout;
  localRound.ranked = ranked;
  recordLocalResult(localRound, result, payout - localRound.bet, message);
  setText('#game-status-text', message);
  updateHeader();
  renderLocalTable();
}

function startNextLocalRound() {
  if (network.roomActive) {
    hostOrRequestOnlineRound(activeMode);
    return;
  }
  localRound = null;
  setText('#game-status-text', 'Choose your bet and deal the next round.');
  setText('#game-pot', '◆ 0');
  renderActionButtons('ready');
  renderLocalTable();
}

function renderLocalTable() {
  if (!localRound) {
    setupTableShell(activeMode, false);
    const seatPlayers = [{ name: state.name, status: 'Your seat', isLocal: true }];
    if (activeMode === 'blackjack') seatPlayers.push({ name: 'House dealer', status: 'Dealer', isDealer: true });
    else seatPlayers.push({ name: 'Friend 1', status: 'Ready' });
    renderSeatAvatars(seatPlayers);
    $('#dealer-area').replaceChildren();
    $('#player-area').replaceChildren();
    setText('#game-pot', '◆ 0');
    setText('#game-balance', `◆ ${formatNumber(state.balance)}`);
    setText('#game-status-text', 'Choose your bet and deal in. This practice table uses virtual chips.');
    renderActionButtons('ready');
    return;
  }
  const round = localRound;
  setText('#game-mode-label', MODE_INFO[round.mode].shortTitle);
  setText('#game-room-label', 'PRACTICE TABLE');
  setText('#game-round-caption', round.phase === 'resolved' ? 'ROUND COMPLETE · PRACTICE' : 'ROUND IN PROGRESS · PRACTICE');
  setText('#game-pot', `◆ ${formatNumber(round.pot)}`);
  setText('#game-balance', `◆ ${formatNumber(state.balance)}`);
  const seats = [{ name: state.name, status: round.player.status, isLocal: true }];
  if (round.mode === 'blackjack') {
    seats.push({ name: 'House dealer', status: round.phase === 'resolved' ? blackjackHandLabel(round.dealerHand) : 'Dealer', isDealer: true });
  } else {
    round.opponents.forEach((player) => seats.push({ name: player.name, status: round.phase === 'resolved' ? 'Revealed' : 'In the hand' }));
  }
  renderSeatAvatars(seats);
  $('#dealer-area').replaceChildren();
  $('#player-area').replaceChildren();
  if (round.mode === 'blackjack') {
    renderCardRow($('#dealer-area'), round.dealerHand, round.phase !== 'resolved' && round.player.status !== 'bust' ? [1] : []);
    addHandCaption($('#dealer-area'), 'DEALER');
    renderCardRow($('#player-area'), round.player.hand, []);
    addHandCaption($('#player-area'), `${state.name.toUpperCase()} · ${blackjackHandLabel(round.player.hand)}`);
  } else {
    renderCardRow($('#player-area'), round.player.hand, []);
    const label = evaluateHandForMode(round.mode, round.player.hand).label;
    addHandCaption($('#player-area'), `${state.name.toUpperCase()} · ${round.phase === 'resolved' ? label.toUpperCase() : 'YOUR HAND'}`);
    if (round.phase === 'resolved') {
      renderCardRow($('#dealer-area'), round.opponents[0]?.hand || [], []);
      addHandCaption($('#dealer-area'), `${round.opponents[0]?.name || 'OPPONENT'} · ${evaluateHandForMode(round.mode, round.opponents[0]?.hand || round.player.hand).label.toUpperCase()}`);
    } else {
      const placeholders = Array.from({ length: Math.min(5, round.opponents.length) }, () => ({ back: true }));
      renderCardRow($('#dealer-area'), placeholders, []);
      addHandCaption($('#dealer-area'), 'OPPONENTS · HIDDEN UNTIL SHOWDOWN');
    }
  }
  renderActionButtons(round.mode === 'blackjack' ? (round.phase === 'resolved' ? 'resolved' : 'blackjack') : (round.phase === 'resolved' ? 'resolved' : 'showdown'));
}

function renderSeatAvatars(players) {
  const container = $('#table-players');
  container.replaceChildren();
  const positions = ['seat-top', 'seat-top-right', 'seat-bottom-right', 'seat-bottom', 'seat-bottom-left', 'seat-top-left'];
  players.slice(0, CONFIG.maximumPlayers).forEach((player, index) => {
    const seat = document.createElement('div');
    seat.className = `table-seat ${positions[index] || 'seat-top'}`;
    const avatar = document.createElement('span');
    avatar.className = 'seat-avatar';
    avatar.textContent = capitalInitial(player.name);
    const name = document.createElement('span');
    name.className = 'seat-name';
    name.textContent = player.name;
    const detail = document.createElement('span');
    detail.className = 'seat-detail';
    detail.textContent = player.status || 'Ready';
    seat.append(avatar, name, detail);
    container.append(seat);
  });
}

function renderCardRow(container, cards, hiddenIndexes = []) {
  container.replaceChildren();
  cards.forEach((card, index) => {
    if (card.back || hiddenIndexes.includes(index)) {
      const back = document.createElement('span');
      back.className = 'playing-card card-back';
      const mark = document.createElement('span');
      mark.className = 'card-center-suit';
      mark.textContent = 'FR';
      back.append(mark);
      container.append(back);
      return;
    }
    const cardElement = document.createElement('span');
    cardElement.className = `playing-card ${card.color === 'red' || card.suit === '♥' || card.suit === '♦' ? 'card-red' : 'card-black'}`;
    cardElement.style.setProperty('--card-tilt', `${(index - (cards.length - 1) / 2) * 2}deg`);
    const rank = document.createElement('span');
    rank.className = 'card-rank';
    rank.textContent = card.rank;
    const suit = document.createElement('span');
    suit.className = 'card-suit';
    suit.textContent = card.suit;
    const center = document.createElement('span');
    center.className = 'card-center-suit';
    center.textContent = card.suit;
    const bottom = document.createElement('span');
    bottom.className = 'card-bottom-rank';
    bottom.textContent = card.rank;
    cardElement.append(rank, suit, center, bottom);
    container.append(cardElement);
  });
}

function addHandCaption(container, text) {
  const caption = document.createElement('span');
  caption.className = `hand-caption ${container.id === 'dealer-area' ? 'dealer-caption' : 'player-caption'}`;
  caption.textContent = text;
  container.append(caption);
}

function renderActionButtons(mode) {
  const group = $('#game-action-buttons');
  group.replaceChildren();
  const addButton = (label, action, className = 'button button-gold', symbol = '') => {
    const button = document.createElement('button');
    button.className = className;
    button.dataset.gameAction = action;
    button.type = 'button';
    button.innerHTML = `${escapeHtml(label)}${symbol ? ` <span>${escapeHtml(symbol)}</span>` : ''}`;
    group.append(button);
    return button;
  };
  if (mode === 'ready') {
    addButton('Deal round', 'deal', 'button button-gold', '↗');
  } else if (mode === 'blackjack') {
    addButton('Hit', 'hit', 'button button-muted', '+');
    addButton('Stand', 'stand', 'button button-gold', '✓');
  } else if (mode === 'showdown') {
    addButton('Reveal & compare', 'showdown', 'button button-gold', '↗');
  } else if (mode === 'resolved') {
    addButton('Deal next round', 'next', 'button button-gold', '↗');
    addButton('Back to lobby', 'back', 'button button-muted');
  } else if (mode === 'online-wait') {
    addButton('Waiting for host…', 'wait', 'button button-muted');
    group.querySelector('button').disabled = true;
  } else if (mode === 'online-blackjack') {
    addButton('Hit', 'hit', 'button button-muted', '+');
    addButton('Stand', 'stand', 'button button-gold', '✓');
  } else if (mode === 'online-showdown') {
    addButton('Reveal hand', 'showdown', 'button button-gold', '↗');
  }
}

/* -------------------------------------------------------------------------- */
/* Online room round logic: host-authoritative prototype                        */
/* -------------------------------------------------------------------------- */
function hostOrRequestOnlineRound(mode) {
  activeMode = mode;
  if (!network.roomActive) {
    setupTableShell(mode, false);
    renderLocalTable();
    return;
  }
  if (network.isHost) {
    hostStartOnlineRound(mode, readBet());
  } else if (network.hostConnection && network.hostConnection.open) {
    network.hostConnection.send({ type: 'START_REQUEST', mode, bet: readBet() });
    setupTableShell(mode, true);
    setText('#game-status-text', 'Asked the host to start a round.');
    renderActionButtons('online-wait');
  } else {
    showToast('The host connection is not ready. Rejoin the room and try again.', 'error');
  }
}

function hostStartOnlineRound(mode, requestedBet) {
  if (!network.isHost || !MODE_INFO[mode]) return;
  if (network.game && !network.game.resolved) {
    showToast('Finish the current round before starting another.', 'error');
    return;
  }
  const bet = safeInteger(requestedBet, CONFIG.minimumBet, CONFIG.minimumBet, CONFIG.maximumBet);
  const deck = createDeck();
  const eligible = network.roomPlayers.filter((player) => player.connected !== false && player.balance >= bet);
  if (!eligible.some((player) => player.id === network.ownId)) {
    showToast('The host needs enough virtual chips to start this round.', 'error');
    return;
  }
  const participants = eligible.slice(0, CONFIG.maximumPlayers).map((player) => ({
    id: player.id,
    name: player.name,
    balance: player.balance,
    bet,
    hand: [],
    status: 'playing',
    result: 'playing',
    lastDelta: 0,
    host: Boolean(player.host),
    bot: false
  }));
  if (participants.length === 1) {
    const botCount = Math.min(3, CONFIG.maximumPlayers - participants.length);
    for (let index = 0; index < botCount; index += 1) {
      participants.push({
        id: `bot-${index}-${Date.now()}`,
        name: BOT_NAMES[index % BOT_NAMES.length],
        balance: CONFIG.startingBalance,
        bet,
        hand: [],
        status: 'playing',
        result: 'playing',
        lastDelta: 0,
        host: false,
        bot: true
      });
    }
  }
  participants.forEach((player) => {
    player.balance -= bet;
    player.hand = Array.from({ length: MODE_INFO[mode].cardsPerPlayer }, () => drawCard(deck));
    if (player.bot) player.status = mode === 'blackjack' ? 'stood' : 'revealed';
    const roomPlayer = network.roomPlayers.find((entry) => entry.id === player.id);
    if (roomPlayer) roomPlayer.balance = player.balance;
  });
  const dealerHand = mode === 'blackjack' ? [drawCard(deck), drawCard(deck)] : [];
  network.game = {
    id: `online-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    mode,
    bet,
    pot: bet * participants.length,
    players: participants,
    dealerHand,
    phase: 'playing',
    resolved: false,
    createdAt: new Date().toISOString(),
    note: ''
  };
  if (mode === 'blackjack') {
    participants.forEach((player) => {
      if (sumCardValues(player.hand, true) === 21) player.status = 'stood';
    });
    maybeFinishOnlineBlackjack();
  }
  updateLocalBalanceFromRoom();
  broadcastRoomState();
  broadcastOnlineGame();
  openDialog($('#game-modal'));
  setText('#game-room-label', 'HOSTED PRIVATE ROOM');
  setupTableShell(mode, true);
  renderOnlineTable();
}

function updateLocalBalanceFromRoom() {
  if (!network.isHost) return;
  const own = network.roomPlayers.find((player) => player.id === network.ownId);
  if (own) {
    state.balance = own.balance;
    saveState();
    updateHeader();
  }
}

function playerForNetworkId(id) {
  return network.game?.players?.find((player) => player.id === id);
}

function hostOnlineAction(id, action) {
  if (!network.isHost || !network.game || network.game.resolved) return;
  const game = network.game;
  const player = playerForNetworkId(id);
  if (!player || player.bot || player.status !== 'playing') return;
  if (game.mode === 'blackjack') {
    if (action === 'hit') {
      player.hand.push(drawCard(createDeckForOnlineGame(game)));
      const total = sumCardValues(player.hand, true);
      if (total > 21) {
        player.status = 'bust';
        player.result = 'lost';
        player.lastDelta = -player.bet;
      }
    } else if (action === 'stand') {
      player.status = 'stood';
    }
    maybeFinishOnlineBlackjack();
  } else if (action === 'showdown') {
    player.status = 'revealed';
    maybeResolveOnlineCompetition();
  }
  updateLocalBalanceFromRoom();
  broadcastRoomState();
  broadcastOnlineGame();
}

/* Online games draw from a persistent per-round deck, stored non-enumerably. */
function createDeckForOnlineGame(game) {
  if (!game._deck) {
    const used = new Set();
    game.players.forEach((player) => player.hand.forEach((card) => used.add(card.id)));
    game.dealerHand.forEach((card) => used.add(card.id));
    game._deck = createDeck().filter((card) => !used.has(card.id));
  }
  return game._deck;
}

function handleOnlineAction(id, action) {
  if (!network.isHost) return;
  if (id === network.ownId) {
    hostOnlineAction(id, action);
    return;
  }
  hostOnlineAction(id, action);
}

function allOnlinePlayersFinished() {
  if (!network.game) return true;
  return network.game.players.every((player) => player.status !== 'playing');
}

function maybeFinishOnlineBlackjack() {
  const game = network.game;
  if (!network.isHost || !game || game.mode !== 'blackjack' || game.resolved) return;
  if (!allOnlinePlayersFinished()) return;
  while (sumCardValues(game.dealerHand, true) < 17) {
    game.dealerHand.push(drawCard(createDeckForOnlineGame(game)));
  }
  const dealerTotal = sumCardValues(game.dealerHand, true);
  game.players.forEach((player) => {
    if (player.bot && player.status === 'playing') player.status = sumCardValues(player.hand, true) > 21 ? 'bust' : 'stood';
    if (player.status === 'bust') {
      player.result = 'lost';
      player.lastDelta = -player.bet;
      return;
    }
    const total = sumCardValues(player.hand, true);
    if (total === 21 && player.hand.length === 2 && dealerTotal !== 21) {
      player.result = 'won';
      player.balance += Math.round(player.bet * 2.5);
      player.lastDelta = Math.round(player.bet * 1.5);
    } else if (dealerTotal > 21 || total > dealerTotal) {
      player.result = 'won';
      player.balance += player.bet * 2;
      player.lastDelta = player.bet;
    } else if (total === dealerTotal) {
      player.result = 'push';
      player.balance += player.bet;
      player.lastDelta = 0;
    } else {
      player.result = 'lost';
      player.lastDelta = -player.bet;
    }
    player.status = player.result;
    const roomPlayer = network.roomPlayers.find((entry) => entry.id === player.id);
    if (roomPlayer) roomPlayer.balance = player.balance;
  });
  game.phase = 'resolved';
  game.resolved = true;
  game.note = `Dealer total: ${dealerTotal}`;
}

function maybeResolveOnlineCompetition() {
  const game = network.game;
  if (!network.isHost || !game || game.mode === 'blackjack' || game.resolved) return;
  if (!allOnlinePlayersFinished()) return;
  const ranked = game.players.map((player) => ({ player, hand: evaluateHandForMode(game.mode, player.hand) }));
  ranked.sort((first, second) => compareScores(second.hand, first.hand));
  const best = ranked[0].hand;
  const winners = ranked.filter((entry) => compareScores(entry.hand, best) === 0);
  const payoutBase = Math.floor(game.pot / winners.length);
  let leftover = game.pot - payoutBase * winners.length;
  game.players.forEach((player) => {
    const winningEntry = winners.find((entry) => entry.player.id === player.id);
    if (winningEntry) {
      const payout = payoutBase + (leftover > 0 ? 1 : 0);
      if (leftover > 0) leftover -= 1;
      player.balance += payout;
      player.result = winners.length === 1 ? 'won' : 'push';
      player.lastDelta = payout - player.bet;
    } else {
      player.result = 'lost';
      player.lastDelta = -player.bet;
    }
    player.status = player.result;
    const roomPlayer = network.roomPlayers.find((entry) => entry.id === player.id);
    if (roomPlayer) roomPlayer.balance = player.balance;
  });
  game.phase = 'resolved';
  game.resolved = true;
  game.note = `${winners.map((entry) => entry.player.name).join(', ')} · ${best.label}`;
}

function broadcastOnlineGame() {
  if (!network.isHost || !network.game) return;
  network.connections.forEach((connection, id) => broadcastOnlineGameToOne(id));
  renderOnlineTable();
  const own = playerForNetworkId(network.ownId);
  if (own && network.game.resolved) recordNetworkResult(network.game, own);
}

function broadcastOnlineGameToOne(id) {
  if (!network.isHost || !network.game) return;
  const connection = network.connections.get(id);
  if (!connection) return;
  try {
    connection.send({ type: 'GAME_STATE', game: sanitizeGameForPlayer(network.game, id) });
  } catch (error) {
    console.warn('Could not send private game state.', error);
  }
}

function sanitizeGameForPlayer(game, recipientId) {
  const revealAll = game.resolved;
  const safePlayers = game.players.map((player) => {
    const reveal = revealAll || player.id === recipientId || player.status === 'revealed' || player.status === 'won' || player.status === 'lost' || player.status === 'push' || player.status === 'bust' || player.status === 'stood' && game.mode === 'blackjack';
    return {
      id: player.id,
      name: player.name,
      balance: player.balance,
      bet: player.bet,
      hand: reveal ? player.hand : player.hand.map(() => ({ back: true })),
      status: player.status,
      result: player.result,
      lastDelta: player.lastDelta,
      host: player.host,
      bot: player.bot,
      reveal
    };
  });
  const dealerReveal = revealAll || game.mode !== 'blackjack';
  const dealerHand = dealerReveal
    ? game.dealerHand
    : game.dealerHand.map((card, index) => index === 0 ? card : ({ back: true }));
  return {
    id: game.id,
    mode: game.mode,
    bet: game.bet,
    pot: game.pot,
    players: safePlayers,
    dealerHand,
    phase: game.phase,
    resolved: game.resolved,
    createdAt: game.createdAt,
    note: game.note
  };
}

function renderOnlineTable() {
  const game = network.game;
  if (!game) {
    setupTableShell(activeMode, true);
    renderRoomPreview();
    return;
  }
  activeMode = game.mode;
  setText('#game-mode-label', MODE_INFO[game.mode].shortTitle);
  setText('#game-room-label', network.isHost ? 'HOSTED PRIVATE ROOM' : 'CONNECTED PRIVATE ROOM');
  setText('#game-round-caption', game.resolved ? 'ROUND COMPLETE · PRIVATE ROOM' : `ROUND IN PROGRESS · ${game.players.length} SEATS`);
  setText('#game-pot', `◆ ${formatNumber(game.pot)}`);
  setText('#game-balance', `◆ ${formatNumber(state.balance)}`);
  const own = game.players.find((player) => player.id === network.ownId);
  const seats = game.players.map((player) => ({
    name: player.name,
    status: player.id === network.ownId ? 'Your seat' : player.status === 'playing' ? 'In the hand' : resultLabel(player.result || player.status),
    isLocal: player.id === network.ownId
  }));
  renderSeatAvatars(seats);
  $('#dealer-area').replaceChildren();
  $('#player-area').replaceChildren();
  if (game.mode === 'blackjack') {
    renderCardRow($('#dealer-area'), game.dealerHand || [], []);
    addHandCaption($('#dealer-area'), game.resolved ? `DEALER · ${blackjackHandLabel(game.dealerHand || [])}` : 'DEALER · ONE CARD HIDDEN');
  } else {
    const firstOther = game.players.find((player) => player.id !== network.ownId && player.hand?.length);
    if (firstOther) {
      const otherHandIsVisible = game.resolved || firstOther.reveal || firstOther.status === 'revealed';
      const visibleOtherHand = otherHandIsVisible ? firstOther.hand : firstOther.hand.map(() => ({ back: true }));
      renderCardRow($('#dealer-area'), visibleOtherHand, []);
      const handLabel = otherHandIsVisible ? evaluateHandForMode(game.mode, firstOther.hand.filter((card) => !card.back)).label : 'HIDDEN HAND';
      addHandCaption($('#dealer-area'), `${firstOther.name.toUpperCase()} · ${handLabel.toUpperCase()}`);
    } else {
      const backs = Array.from({ length: Math.min(5, MODE_INFO[game.mode].cardsPerPlayer) }, () => ({ back: true }));
      renderCardRow($('#dealer-area'), backs, []);
      addHandCaption($('#dealer-area'), 'FRIENDS · HIDDEN HANDS');
    }
  }
  if (own) {
    renderCardRow($('#player-area'), own.hand || [], []);
    const label = game.mode === 'blackjack'
      ? blackjackHandLabel((own.hand || []).filter((card) => !card.back))
      : (own.reveal || game.resolved ? evaluateHandForMode(game.mode, (own.hand || []).filter((card) => !card.back)).label : 'YOUR HAND');
    addHandCaption($('#player-area'), `${state.name.toUpperCase()} · ${label.toUpperCase()}`);
  }
  const statusMessage = onlineStatusMessage(game, own);
  setText('#game-status-text', statusMessage);
  if (game.resolved) {
    renderActionButtons('resolved');
  } else if (game.mode === 'blackjack') {
    if (own && own.status === 'playing') renderActionButtons('online-blackjack');
    else renderActionButtons('online-wait');
  } else if (own && own.status === 'playing') {
    renderActionButtons('online-showdown');
  } else {
    renderActionButtons('online-wait');
  }
}

function onlineStatusMessage(game, own) {
  if (!own) return 'Waiting for your seat assignment…';
  if (game.resolved) {
    const labels = { won: 'You won this round.', lost: 'This round went to another hand.', push: 'A tie — your share has been returned.' };
    return `${labels[own.result] || 'Round complete.'} ${game.note || ''}`.trim();
  }
  if (game.mode === 'blackjack') {
    if (own.status !== 'playing') return 'You have finished your turn. Waiting for the table to finish.';
    return `Your total is ${sumCardValues((own.hand || []).filter((card) => !card.back), true)}. Choose hit or stand.`;
  }
  if (own.status !== 'playing') return 'Your hand is revealed. Waiting for the remaining players.';
  return 'Your cards are dealt. Reveal your hand when you are ready.';
}

function renderRoomPreview() {
  const seats = network.roomPlayers.length ? network.roomPlayers.map((player) => ({ name: player.name, status: player.host ? 'Host' : 'Connected' })) : [{ name: state.name, status: 'Your seat' }];
  renderSeatAvatars(seats);
  $('#dealer-area').replaceChildren();
  $('#player-area').replaceChildren();
  renderCardRow($('#dealer-area'), [{ back: true }, { back: true }], []);
  addHandCaption($('#dealer-area'), 'READY TO PLAY');
  renderCardRow($('#player-area'), [{ back: true }, { back: true }], []);
  addHandCaption($('#player-area'), 'CARDS WAITING TO BE DEALT');
  setText('#game-status-text', `${network.roomPlayers.length} of ${CONFIG.maximumPlayers} seats occupied. Start a mode to deal a round.`);
  renderActionButtons(network.isHost ? 'ready' : 'online-wait');
}

function performTableAction(action) {
  if (action === 'back') {
    closeDialog($('#game-modal'));
    switchView('lobby');
    return;
  }
  if (action === 'wait') return;
  if (network.roomActive) {
    if (action === 'deal' || action === 'next') {
      hostOrRequestOnlineRound(activeMode);
      return;
    }
    if (network.isHost) {
      handleOnlineAction(network.ownId, action);
    } else if (network.hostConnection && network.hostConnection.open) {
      network.hostConnection.send({ type: 'ACTION', action });
    } else {
      showToast('Your connection to the host is unavailable.', 'error');
    }
    return;
  }
  if (action === 'deal' || action === 'next') {
    dealLocalRound();
  } else if (action === 'hit') {
    localBlackjackHit();
  } else if (action === 'stand') {
    localBlackjackStand();
  } else if (action === 'showdown') {
    localShowdown();
  }
}

/* -------------------------------------------------------------------------- */
/* Rules dialogs and free virtual-chip refill                                   */
/* -------------------------------------------------------------------------- */
function openRules(mode = activeMode) {
  const info = MODE_INFO[mode] || MODE_INFO.blackjack;
  const content = $('#rules-modal-content');
  content.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = info.title;
  const paragraph = document.createElement('p');
  paragraph.textContent = info.rules;
  const tipsHeading = document.createElement('h3');
  tipsHeading.textContent = 'Table notes';
  const list = document.createElement('ul');
  info.tips.forEach((tip) => {
    const item = document.createElement('li');
    item.textContent = tip;
    list.append(item);
  });
  content.append(heading, paragraph, tipsHeading, list);
  openDialog($('#rules-modal'));
}

function freeChipRefill() {
  if (state.balance >= CONFIG.refillThreshold) {
    showToast(`You still have ${formatNumber(state.balance)} virtual chips. The free refill is for low balances.`);
    return;
  }
  state.balance += CONFIG.freeRefillAmount;
  saveState();
  updateHeader();
  showToast(`${formatNumber(CONFIG.freeRefillAmount)} free virtual chips added. No purchase required.`);
  if (localRound && localRound.phase !== 'resolved') renderLocalTable();
  if (network.roomActive && network.isHost) {
    const player = network.roomPlayers.find((entry) => entry.id === network.ownId);
    if (player) player.balance = state.balance;
    broadcastRoomState();
  } else if (network.roomActive && network.hostConnection) {
    sendRoomMessage({ type: 'PROFILE_UPDATE', name: state.name, balance: state.balance });
  }
}

/* -------------------------------------------------------------------------- */
/* Buttons, navigation and form wiring                                          */
/* -------------------------------------------------------------------------- */
function bindEvents() {
  $$('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-launch]').forEach((button) => button.addEventListener('click', () => launchGame(button.dataset.launch)));

  $('#profile-open')?.addEventListener('click', openProfile);
  $('#save-profile')?.addEventListener('click', saveProfile);
  $('#profile-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveProfile();
  });

  $('#quick-play')?.addEventListener('click', () => launchGame('blackjack'));
  $('#activity-button')?.addEventListener('click', () => switchView('activity'));
  $('#hero-create-room')?.addEventListener('click', () => openRoomDialog('create'));
  $('#sidebar-create-room')?.addEventListener('click', () => openRoomDialog('create'));
  $('#lower-create-room')?.addEventListener('click', () => openRoomDialog('create'));
  $('#tables-create-room')?.addEventListener('click', () => openRoomDialog('create'));
  $('#open-join-room')?.addEventListener('click', () => openRoomDialog('join'));
  $('#tables-join-room')?.addEventListener('click', () => openRoomDialog('join'));
  $('#room-primary-action')?.addEventListener('click', () => {
    if (roomDialogMode === 'join') joinPrivateRoom();
    else if (network.roomActive && network.isHost) {
      closeDialog($('#room-modal'));
      activeMode = 'blackjack';
      openDialog($('#game-modal'));
      setupTableShell(activeMode, true);
      renderRoomPreview();
    } else createPrivateRoom();
  });
  $('#switch-room-mode')?.addEventListener('click', switchRoomDialogMode);
  $('#copy-room-code')?.addEventListener('click', () => copyText(network.roomCode || $('#room-code-value').textContent, 'Room code copied.'));
  $('#room-name-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      createPrivateRoom();
    }
  });
  $('#join-code-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      joinPrivateRoom();
    }
  });
  $('#room-search')?.addEventListener('input', renderRoomList);

  $('#game-close')?.addEventListener('click', () => closeDialog($('#game-modal')));
  $('#table-back-button')?.addEventListener('click', () => {
    closeDialog($('#game-modal'));
    switchView('lobby');
  });
  $('#table-rules-button')?.addEventListener('click', () => openRules(activeMode));
  $('#rules-close')?.addEventListener('click', () => closeDialog($('#rules-modal')));
  $('#rules-done')?.addEventListener('click', () => closeDialog($('#rules-modal')));
  $('#bonus-button')?.addEventListener('click', freeChipRefill);
  $('#deal-button')?.addEventListener('click', dealLocalRound);
  $('#bet-down')?.addEventListener('click', () => stepBet(-1));
  $('#bet-up')?.addEventListener('click', () => stepBet(1));
  $('#bet-amount')?.addEventListener('change', readBet);
  $('#game-action-buttons')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-game-action]');
    if (!button) return;
    performTableAction(button.dataset.gameAction);
  });
  $('#clear-activity')?.addEventListener('click', () => {
    if (!state.activity.length) {
      showToast('There is no activity history to clear.');
      return;
    }
    state.activity = [];
    saveState();
    renderRecentActivity();
    renderFullActivity();
    renderLeaderboard();
    showToast('Local activity history cleared.');
  });

  $$('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && dialog.id !== 'game-modal') closeDialog(dialog);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const openDialogs = $$('dialog[open]');
      if (openDialogs.length > 1) closeDialog(openDialogs[openDialogs.length - 1]);
    }
  });
}

function stepBet(direction) {
  const current = readBet();
  const next = Math.max(CONFIG.minimumBet, Math.min(CONFIG.maximumBet, current + direction * CONFIG.betStep));
  $('#bet-amount').value = String(next);
}

/* -------------------------------------------------------------------------- */
/* Startup and light diagnostics                                                */
/* -------------------------------------------------------------------------- */
function initializeApp() {
  bindEvents();
  updateHeader();
  renderRecentActivity();
  renderFullActivity();
  renderLeaderboard();
  renderRoomList();
  setupTableShell(activeMode, false);
  updateRoomCounts();
  const today = new Date();
  const weekday = today.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase();
  setText('#today-label', `${weekday} · FRIENDS · CARDS · GOOD TIMES`);
  console.info('Felt Royale ready. Max table size:', CONFIG.maximumPlayers);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
  initializeApp();
}

/* -------------------------------------------------------------------------- */
/* Reference notes: the sections below document the intended behavior.         */
/* They deliberately live with the source so a beginner can understand the     */
/* game structure without a separate documentation file.                       */
/* -------------------------------------------------------------------------- */
