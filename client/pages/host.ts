import { mountAudioControls } from '../audio-controls.ts';
import {
  mountLanguageSwitch,
  onLanguageChange,
  t,
  weaponText,
  getLanguage,
  bindTranslations,
  translateMessage,
} from '../i18n.ts';
import { rankStandings } from '../standings.ts';
import { waitingForSummary } from '../race-presentation.ts';
import { resultsPodium } from '../results.ts';
import { roomSettings } from '../room-settings.ts';
import { MAPS, DEFAULT_SETTINGS } from '../../shared/maps.ts';
import QRCode from 'qrcode';
import { app, $, header, toast } from '../core/dom.ts';
import { api, safeSession } from '../core/api.ts';
import { connectGame, createInput, type GameSocket } from '../core/network.ts';
import { getScene } from '../core/scene.ts';
import { Sound } from '../audio.ts';
import type { GameScene } from '../scene.ts';
import { type Session, type Snapshot } from '../../shared/types.ts';
import type { HostCommand, NetworkInfo } from '../../shared/protocol.ts';
const sound = new Sound();
let scene: GameScene | null = null,
  current: Snapshot | null = null,
  hostSocket: GameSocket | null = null,
  keyboardId: string | null = null,
  keyboardController: GameSocket | null = null;
let updateSettings: ((state: Snapshot) => void) | null = null;
async function hostCommand(
  action: Exclude<HostCommand['action'], 'settings'>,
  id?: string,
): Promise<void> {
  if (!hostSocket?.connected) throw new Error(t('Brak połączenia z serwerem.'));
  const command: HostCommand = action === 'remove' ? { action, id: id ?? '' } : { action };
  const result = await hostSocket.timeout(4000).emitWithAck('host', command);
  if (!result.ok) throw new Error(result.error);
}
async function returnToLobby() {
  const button = $<HTMLButtonElement>('#rematch');
  if (button.disabled) return;
  const feedback = $('#results-feedback');
  button.disabled = true;
  feedback.hidden = true;
  try {
    await hostCommand('lobby');
  } catch (error) {
    feedback.textContent = translateMessage((error as Error).message);
    feedback.hidden = false;
  } finally {
    button.disabled = false;
  }
}
export async function hostPage(code: string) {
  const fragment = new URLSearchParams(location.hash.slice(1)),
    stored = safeSession('turbo:host:' + code);
  const session: Session | null = fragment.get('key')
    ? { code, token: fragment.get('key')!, role: 'host' }
    : stored;
  if (!session) {
    app.innerHTML = /* HTML */ `${header()}
      <main class="error-page">
        <h1>To jest ekran hosta.</h1>
        <p id="host-error-instruction">
          ${t('Aby grać telefonem, dołącz kodem {code}.', { code })}
        </p>
        <a class="button primary" href="/join?code=${code}">Otwórz pad →</a
        ><a href="/">Wróć na stronę główną</a>
      </main>`;
    mountLanguageSwitch(app);
    onLanguageChange(() => {
      $('#host-error-instruction').textContent = t('Aby grać telefonem, dołącz kodem {code}.', {
        code,
      });
    });
    return;
  }
  localStorage.setItem('turbo:host:' + code, JSON.stringify(session));
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  document.body.className = 'host-page';
  app.innerHTML = /* HTML */ `${header(`<div class="host-track"><span class="live-dot"></span> <span id="host-map-name">SUNDOWN CIRCUIT XL</span> <b id="host-map-index">01</b></div><div class="host-actions"><span id="host-connection" class="connection">Łączenie…</span><button class="icon-button" id="sound-toggle" aria-label="Włącz dźwięk">♪</button><button class="icon-button" id="fullscreen" aria-label="Pełny ekran">⛶</button></div>`)}
    <main class="arena">
      <div class="game-viewport">
        <div id="game-world"></div>
        <div class="race-vignette"></div>
        <div id="race-hud" hidden>
          <div class="lap-banner">
            <small>OKRĄŻENIE</small><b id="lap-value">1<span>/3</span></b>
          </div>
          <div class="standings" id="standings"></div>
          <div class="room-chip">POKÓJ <b>${code}</b></div>
          <div class="race-bottom">
            <span id="round-number">RUNDA 1</span><span id="keyboard-hint"></span>
          </div>
        </div>
        <div id="host-center" class="host-center" hidden></div>
        <section id="host-settings"></section>
        <aside class="lobby-panel" id="lobby-panel">
          <div class="join-panel-title">
            <span class="card-kicker">WEŹ TELEFON I DOŁĄCZ</span><span class="small-dot"></span>
          </div>
          <div class="room-join">
            <img id="join-qr" alt="Zeskanuj, aby dołączyć telefonem" />
            <div>
              <small>KOD POKOJU</small><strong>${code}</strong
              ><a id="join-link" href="/join?code=${code}" target="_blank" rel="noopener"
                >Otwórz pad ↗</a
              >
            </div>
          </div>
          <p id="network-instruction" class="network-instruction">
            Ładowanie adresu dla telefonów…
          </p>
          <div class="players-heading">
            <b>NA LINII STARTU</b><span id="player-count">0 / 8</span>
          </div>
          <div id="lobby-players" class="lobby-players"></div>
          <div class="lobby-tools">
            <button class="button subtle" id="add-keyboard">+ Klawiatura</button
            ><button class="button subtle" id="add-bot">+ Bot</button>
          </div>
          <button class="button primary start-button" id="start-race" disabled>
            Start wyścigu <span>→</span>
          </button>
          <p class="lobby-footnote" id="start-help">
            Pierwszy gracz jest adminem. Wszyscy gotowi? Start za 5 sekund.
          </p>
        </aside>
        <div class="loading-badge" id="loading">PRZYGOTOWUJĘ TOR…</div>
        <dialog class="results-panel" id="results" aria-labelledby="results-title"></dialog>
      </div>
    </main>`;
  mountLanguageSwitch(app);
  $('#results').addEventListener('cancel', (event) => {
    event.preventDefault();
    void returnToLobby();
  });
  $('#add-bot').onclick = () => void hostCommand('bot').catch((e) => toast(e.message));
  $('#add-keyboard').onclick = () => {
    if (keyboardId && keyboardController?.connected) {
      const ready = current?.cars.find((car) => car.id === keyboardId)?.ready ?? false;
      keyboardController.emit('ready', !ready);
    } else void joinKeyboard(code).catch((e) => toast(e.message));
  };
  $('#start-race').onclick = () => void hostCommand('start').catch((e) => toast(e.message));
  const audioControls = mountAudioControls(sound, $('#sound-toggle'));
  $('#fullscreen').onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement
        .requestFullscreen()
        .catch(() => toast('Pełny ekran nie jest dostępny w tej przeglądarce.'));
  };
  const info = await api<NetworkInfo>('/api/info');
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname),
    base =
      info.publicUrl ?? (isLoopback ? (info.networkUrls[0] ?? location.origin) : location.origin),
    url = base + '/join?code=' + code;
  $('#join-link').setAttribute('href', url);
  $('#network-instruction').textContent = t('Ta sama sieć Wi-Fi · {address}', {
    address: base.replace(/^https?:\/\//, ''),
  });
  $<HTMLImageElement>('#join-qr').src = await QRCode.toDataURL(url, {
    width: 220,
    margin: 1,
    color: { dark: '#19293a', light: '#fffaf0' },
  });
  const socket = connectGame(session);
  hostSocket = socket;
  updateSettings = roomSettings($('#host-settings'), socket, { host: true });
  const hostConnected = new Promise<void>((resolve) => socket.once('connect', resolve));
  socket.on('connect', () => {
    $('#host-connection').textContent = 'Online';
    $('#host-connection').classList.add('online');
  });
  socket.on('disconnect', () => {
    if (current) sound.update({ ...current, phase: 'paused' }, keyboardId);
    $('#host-connection').textContent = t('Łączenie…');
    $('#host-connection').classList.remove('online');
    toast('Utracono połączenie. Próbuję połączyć ponownie.');
  });
  socket.on('connect_error', (e) => toast(e.message));
  socket.on('state', (state: Snapshot) => {
    current = state;
    scene?.setState(state);
    renderHost(state);
  });
  try {
    const s = (scene = await getScene($('#game-world')));
    if (current) s.setState(current);
    $('#loading').hidden = true;
    renderHost(current);
  } catch {
    toast('Grafika 3D nie mogła wystartować.');
  }
  onLanguageChange(() => {
    audioControls.refresh();
    $('#network-instruction').textContent = t('Ta sama sieć Wi-Fi · {address}', {
      address: base.replace(/^https?:\/\//, ''),
    });
    $('#host-connection').textContent = socket.connected ? 'Online' : t('Łączenie…');
    renderHost(current);
  });
  await hostConnected;
  if (new URLSearchParams(location.search).get('quick') === '1') {
    history.replaceState(null, '', location.pathname);
    try {
      await hostCommand('bot');
      await hostCommand('bot');
      await joinKeyboard(code);
      await hostCommand('start');
    } catch (e) {
      toast((e as Error).message);
    }
  } else if (safeSession('turbo:keyboard:' + code))
    void joinKeyboard(code).catch(() => {
      localStorage.removeItem('turbo:keyboard:' + code);
    });
}
let scoreRoom = '',
  scorePhase = '',
  previousScores = new Map<string, number>(),
  roundChanges = new Map<string, number>();
let disposeResultsText: (() => void) | undefined;
function renderHost(state: Snapshot | null) {
  if (!state) return;
  const settings = state.settings ?? DEFAULT_SETTINGS;
  $('#host-map-name').textContent = MAPS[settings.mapId].name.toUpperCase();
  $('#host-map-index').textContent = String(Object.keys(MAPS).indexOf(settings.mapId) + 1).padStart(
    2,
    '0',
  );
  updateSettings?.(state);
  const lobby = state.phase === 'lobby';
  const summaryPending = waitingForSummary(state);
  $('#lobby-panel').hidden = !lobby;
  $('#race-hud').hidden = !['racing', 'countdown'].includes(state.phase);
  const resultDialog = $<HTMLDialogElement>('#results');
  if ((state.phase !== 'finished' || summaryPending) && resultDialog.open) resultDialog.close();
  $('.game-viewport').dataset.phase = state.phase;
  if (scoreRoom !== state.code) {
    scoreRoom = state.code;
    scorePhase = '';
    previousScores.clear();
    roundChanges.clear();
  }
  if (state.phase === 'segment' && scorePhase !== 'segment') {
    roundChanges = new Map(
      state.cars
        .filter((c) => previousScores.has(c.id))
        .map((c) => [c.id, c.score - previousScores.get(c.id)!]),
    );
  }
  previousScores = new Map(state.cars.map((c) => [c.id, c.score]));
  scorePhase = state.phase;
  const rankedCars = rankStandings(state.cars);
  if (lobby) {
    $('#player-count').textContent = `${state.cars.length} / 8`;
    const list = $('#lobby-players');
    const signature = state.cars
      .map((c) => `${getLanguage()}:${c.id}:${c.ready}:${c.connected}:${c.name}:${state.adminId}`)
      .join('|');
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature;
      list.replaceChildren();
      for (const c of state.cars) {
        const row = document.createElement('div');
        row.className = 'lobby-player';
        const badge = document.createElement('span');
        badge.className = 'player-avatar';
        badge.style.background = c.color;
        badge.textContent = String(c.slot + 1);
        const name = document.createElement('b');
        name.textContent = c.name;
        name.title = c.name + (state.adminId === c.id ? ' · ADMIN' : '');
        const status = document.createElement('small');
        status.textContent = c.bot
          ? 'BOT'
          : !c.connected
            ? t('ŁĄCZENIE')
            : c.ready
              ? t('GOTOWY')
              : t('CZEKA');
        if (state.adminId === c.id) status.textContent = 'ADMIN · ' + status.textContent;
        status.className = c.ready && c.connected ? 'ready-text' : '';
        const remove = document.createElement('button');
        remove.textContent = '×';
        remove.className = 'remove-player';
        remove.setAttribute('aria-label', t('Usuń gracza {name}', { name: c.name }));
        remove.onclick = () => void hostCommand('remove', c.id).catch((e) => toast(e.message));
        row.append(badge, name, status, remove);
        list.append(row);
      }
      if (!state.cars.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-lobby';
        empty.textContent = t('Pierwszy na starcie? To miejsce jest twoje.');
        list.append(empty);
      }
    }
    $<HTMLButtonElement>('#start-race').disabled =
      !state.canStart || !scene || !$('#loading').hidden;
    $('#start-help').textContent = state.canStart
      ? t('Wszyscy gotowi — automatyczny start za 5 sekund.')
      : state.cars.length < 2
        ? t('Pierwszy gracz jest adminem. Wszyscy gotowi? Start za 5 sekund.')
        : t('Czekamy na gotowość wszystkich telefonów.');
    $<HTMLButtonElement>('#add-bot').disabled = state.cars.length >= 8;
    const keyboard = state.cars.find((car) => car.id === keyboardId);
    $<HTMLButtonElement>('#add-keyboard').disabled = !keyboard && state.cars.length >= 8;
    $('#add-keyboard').textContent = keyboard
      ? keyboard.ready
        ? t('✓ Gotowy · cofnij')
        : t('Jestem gotowy')
      : t('+ Klawiatura');
  }
  $('#lap-value').innerHTML = `${state.lap}<span>/${state.lapLimit}</span>`;
  $('#round-number').textContent = t('RUNDA {round}', { round: state.round });
  $('#keyboard-hint').textContent = keyboardId
    ? t('A / D lub ← / → · SPACJA = BROŃ · ↓ = HAMULEC')
    : '';
  const standings = $('#standings');
  standings.replaceChildren();
  standings.style.setProperty('--score-rows', String(Math.max(1, state.cars.length)));
  standings.setAttribute('aria-label', t('Punktacja wyścigu'));
  for (const [i, c] of rankedCars.entries()) {
    const row = document.createElement('div');
    row.className = 'standing' + (!c.alive ? ' out' : '');
    row.style.setProperty('--car-color', c.color);
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = String(i + 1);
    const name = document.createElement('b');
    name.className = 'standing-name';
    name.textContent = c.name;
    name.title = c.name;
    const score = document.createElement('strong');
    score.className = 'standing-score';
    score.append(String(c.score));
    const unit = document.createElement('small');
    unit.textContent = t('PKT');
    score.append(unit);
    const weapon = document.createElement('span');
    weapon.className = 'standing-weapon';
    weapon.textContent = !c.alive ? '×' : c.weapon ? weaponText(c.weapon).icon : '·';
    weapon.setAttribute(
      'aria-label',
      !c.alive ? t('Poza rundą') : c.weapon ? weaponText(c.weapon).name : t('Brak przedmiotu'),
    );
    row.append(rank, name, score, weapon);
    standings.append(row);
  }
  const center = $('#host-center');
  center.hidden = !['countdown', 'segment', 'paused'].includes(state.phase) || summaryPending;
  center.className = 'host-center ' + state.phase;
  center.replaceChildren();
  if (state.phase === 'countdown') {
    const small = document.createElement('small');
    small.textContent = t('TRZYMAJ SIĘ TORU');
    const big = document.createElement('b');
    big.textContent = String(Math.ceil(state.seconds) || 'GO');
    center.append(small, big);
  }
  if (state.phase === 'segment') {
    const small = document.createElement('small');
    small.textContent = t('RUNDA {round} ZAKOŃCZONA', { round: state.round });
    const title = document.createElement('b');
    title.textContent = t('Punktacja po rundzie');
    const scores = document.createElement('div');
    scores.className = 'round-scores';
    for (const c of rankedCars) {
      const row = document.createElement('div');
      row.className = 'round-score';
      row.style.setProperty('--car-color', c.color);
      const name = document.createElement('span');
      name.textContent = c.name;
      name.title = c.name;
      const total = document.createElement('strong');
      total.textContent = c.score + ' ' + t('PKT');
      const change = document.createElement('b'),
        delta = roundChanges.get(c.id);
      change.className =
        'round-delta' +
        (delta !== undefined && delta > 0
          ? ' positive'
          : delta !== undefined && delta < 0
            ? ' negative'
            : '');
      change.textContent = delta === undefined ? '' : delta > 0 ? '+' + delta : String(delta);
      change.setAttribute(
        'aria-label',
        delta === undefined
          ? ''
          : t('Zmiana punktów: {delta}', {
              delta: (delta > 0 ? '+' : '') + delta,
            }),
      );
      row.append(name, change, total);
      scores.append(row);
    }
    const next = document.createElement('p');
    next.className = 'round-next';
    next.textContent = t('Za chwilę kolejny start');
    center.append(small, title, scores, next);
  }
  if (state.phase === 'paused') {
    const title = document.createElement('b');
    title.textContent = t('PAUZA');
    const text = document.createElement('p');
    text.textContent = t('Czekamy na połączenie z ekranem hosta.');
    center.append(title, text);
  }
  if (state.phase === 'finished' && !summaryPending) {
    const results = $('#results');
    if (
      results.dataset.tick !==
      getLanguage() + String(state.results.map((r) => r.id + r.score).join())
    ) {
      results.dataset.tick = getLanguage() + state.results.map((r) => r.id + r.score).join();
      results.innerHTML = /* HTML */ ` <p class="eyebrow">KONIEC ROZRÓBY</p>
        <h1 id="results-title" tabindex="-1" autofocus>Tak się wygrywa.</h1>
        <div id="results-content"></div>
        <p class="rematch-help">Jeszcze raz? Wróćcie do lobby i potwierdźcie gotowość.</p>
        <p id="results-feedback" role="alert" hidden></p>
        <div class="result-actions">
          <button class="button primary" id="rematch">Rewanż ↗</button>
          <a class="button subtle" href="/">Menu główne</a>
        </div>`;
      disposeResultsText?.();
      disposeResultsText = bindTranslations(results);
      $('#results-content').append(resultsPodium(state.results));
      // A finished match resets readiness. Let everyone ready up in the lobby.
      $('#rematch').onclick = () => void returnToLobby();
    }
    if (!resultDialog.open) resultDialog.showModal();
  }
  sound.update(state, keyboardId);
}
async function joinKeyboard(code: string) {
  if (keyboardId) return;
  const session =
    safeSession('turbo:keyboard:' + code) ??
    (await api<Session>('/api/join', { code, name: t('Ty · klawiatura') }));
  localStorage.setItem('turbo:keyboard:' + code, JSON.stringify(session));
  const socket = connectGame(session);
  const input = createInput(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  keyboardId = session.playerId!;
  keyboardController = socket;
  await new Promise<void>((resolve) => socket.emit('ready', true, () => resolve()));
  const held = new Set<string>();
  const sync = () =>
    input.set(
      held.has('ArrowLeft') || held.has('KeyA') || held.has('ArrowDown'),
      held.has('ArrowRight') || held.has('KeyD') || held.has('ArrowDown'),
    );
  const keydown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest('input,textarea,select,button')) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'KeyA', 'KeyD', 'Space'].includes(e.code)) return;
    e.preventDefault();
    if (e.code === 'Space') {
      if (!e.repeat) input.fire();
    } else {
      held.add(e.code);
      sync();
    }
  };
  const keyup = (e: KeyboardEvent) => {
      held.delete(e.code);
      sync();
    },
    blur = () => {
      held.clear();
      input.reset();
    };
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);
  socket.on('disconnect', (reason) => {
    blur();
    if (reason === 'io server disconnect') {
      keyboardId = null;
      keyboardController = null;
      localStorage.removeItem('turbo:keyboard:' + code);
      input.dispose();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      if (current) renderHost(current);
    }
  });
  socket.on('connect', () => socket.emit('ready', true));
  toast('Klawiatura gotowa: A / D, spacja = przedmiot, ↓ = hamulec.');
}
