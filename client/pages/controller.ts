import {
  mountLanguageSwitch,
  onLanguageChange,
  t,
  weaponText,
  raceMessage,
  translateMessage,
} from '../i18n.ts';
import { roomSettings } from '../room-settings.ts';
import { waitingForSummary } from '../race-presentation.ts';
import { app, $, logo, toast } from '../core/dom.ts';
import { connectGame, createInput } from '../core/network.ts';
import { type Session, type Snapshot } from '../../shared/types.ts';
export function controller(session: Session) {
  document.body.className = 'controller-page';
  app.innerHTML = /* HTML */ `<div class="pad-shell">
    <header class="pad-header">
      <a class="brand small" href="/">${logo}</a
      ><span class="pad-room">POKÓJ <b>${session.code}</b></span
      ><span id="pad-connection" class="connection">Łączenie…</span>
    </header>
    <section class="pad-identity">
      <span class="driver-badge" id="pad-number">1</span>
      <div>
        <small>TWÓJ SAMOCHÓD</small>
        <h1 id="pad-name">Kierowca</h1>
      </div>
      <span class="pad-score" id="pad-score">5 <small>PKT</small></span>
    </section>
    <div class="pad-status">
      <span id="pad-status-text">Łączę z hostem…</span
      ><button class="button primary" id="ready-button">Jestem gotowy <span>✓</span></button>
    </div>
    <section id="pad-settings"></section>
    <main class="pad-controls">
      <section class="direction-controls">
        <button class="pad-key left-key" id="left-control" aria-label="Skręć w lewo">
          <span>←</span><small>LEWO</small></button
        ><button class="pad-key right-key" id="right-control" aria-label="Skręć w prawo">
          <span>→</span><small>PRAWO</small></button
        ><span class="brake-tip">DŁUGI SKRĘT = DRIFT · OBA = HAMULEC</span>
      </section>
      <section class="fire-controls">
        <button id="fire-control" class="fire-key" aria-label="Użyj przedmiotu">
          <span id="weapon-icon">ϟ</span><b id="weapon-name">PRZEDMIOT</b></button
        ><span id="weapon-help">Zbieraj złote kryształy na torze</span>
      </section>
    </main>
    <footer class="pad-footer">
      <span id="pad-phase">CZEKAMY NA EKIPĘ</span
      ><button class="text-button" id="pad-rejoin">Zmień pokój</button>
    </footer>
    <div class="pad-knockout" id="knockout" hidden>
      <b>BUM!</b><span>Wracasz w następnej rundzie.</span>
    </div>
    <div class="pad-countdown" id="pad-countdown" hidden></div>
  </div>`;
  mountLanguageSwitch(app);
  const socket = connectGame(session),
    input = createInput(socket);
  const updateSettings = roomSettings($('#pad-settings'), socket, { playerId: session.playerId! });
  let ready = false,
    latest: Snapshot | null = null,
    dead = false;
  const pointers = new Map<number, 'left' | 'right'>();
  const sync = () => {
    const l = [...pointers.values()].includes('left'),
      r = [...pointers.values()].includes('right');
    input.set(l, r);
    $('#left-control').classList.toggle('pressed', l);
    $('#right-control').classList.toggle('pressed', r);
  };
  for (const [id, direction] of [
    ['left-control', 'left'],
    ['right-control', 'right'],
  ] as const) {
    const el = $('#' + id);
    el.onpointerdown = (e) => {
      e.preventDefault();
      if (latest?.phase !== 'racing' || dead) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, direction);
      sync();
    };
    const release = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      sync();
    };
    el.onpointerup = release;
    el.onpointercancel = release;
    el.onlostpointercapture = release;
  }
  $('#fire-control').onpointerdown = (e) => {
    e.preventDefault();
    if (latest?.phase === 'racing' && !dead) {
      input.fire();
      $('#fire-control').classList.add('pressed');
    }
  };
  for (const event of ['pointerup', 'pointercancel', 'pointerleave'])
    $('#fire-control').addEventListener(event, () =>
      $('#fire-control').classList.remove('pressed'),
    );
  const reset = () => {
    pointers.clear();
    input.reset();
    sync();
    $('#fire-control').classList.remove('pressed');
  };
  window.addEventListener('blur', reset);
  window.addEventListener('orientationchange', reset);
  screen.orientation?.addEventListener('change', reset);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reset();
  });
  $('#ready-button').onclick = () => {
    ready = !ready;
    socket.emit('ready', ready);
  };
  $('#pad-rejoin').onclick = () => {
    localStorage.removeItem('turbo:player:' + session.code);
    input.dispose();
    socket.disconnect();
    location.href = '/join';
  };
  socket.on('connect', () => {
    $('#pad-connection').textContent = t('Połączono');
    $('#pad-connection').classList.add('online');
    reset();
  });
  socket.on('disconnect', (reason) => {
    $('#pad-connection').textContent =
      reason === 'io server disconnect' ? t('Pad odłączony') : t('Łączenie ponownie…');
    $('#pad-connection').classList.remove('online');
    reset();
    if (reason === 'io server disconnect')
      toast('Pad został odłączony przez hosta lub otwarty w innym oknie.');
  });
  socket.on('connect_error', (e) => {
    toast(translateMessage(e.message));
    $('#pad-connection').textContent = t('Brak połączenia');
  });
  const render = (state: Snapshot) => {
    latest = state;
    updateSettings(state);
    const car = state.cars.find((c) => c.id === session.playerId);
    if (!car) return;
    document.documentElement.style.setProperty('--player', car.color);
    $('#pad-name').textContent = car.name;
    $('#pad-number').textContent = String(car.slot + 1);
    $('#pad-score').innerHTML = `${car.score} <small>${t('PKT')}</small>`;
    ready = car.ready;
    const summaryPending = waitingForSummary(state);
    const inLobby = state.phase === 'lobby' || (state.phase === 'finished' && !summaryPending);
    const mayReady = inLobby || state.phase === 'countdown';
    $('#ready-button').hidden = !mayReady;
    $('#ready-button').textContent = ready ? t('Gotowy! ✓') : t('Jestem gotowy ✓');
    $('#ready-button').classList.toggle('is-ready', ready);
    $('#pad-status-text').textContent = summaryPending
      ? t('RUNDA {round} ZAKOŃCZONA', { round: state.round })
      : inLobby
        ? state.phase === 'finished'
          ? raceMessage(state)
          : ready
            ? t('Czekamy na gotowość całej ekipy.')
            : t('Potwierdź gotowość i spójrz na duży ekran.')
        : state.phase === 'paused'
          ? t('Pauza — czekamy na ekran hosta.')
          : state.phase === 'segment'
            ? raceMessage(state)
            : t('Gaz automatyczny. Zakręty pokonujesz sam.');
    const weapon = car.weapon ? weaponText(car.weapon) : null;
    $('#weapon-icon').textContent = weapon?.icon ?? '+';
    $('#weapon-name').textContent = weapon?.name.toUpperCase() ?? t('PUSTY SLOT');
    $('#weapon-help').textContent = weapon?.help ?? t('Zbieraj złote kryształy na torze');
    $('#fire-control').style.setProperty('--weapon', weapon?.color ?? car.color);
    $('#fire-control').classList.toggle('empty', !weapon);
    $('#pad-phase').textContent = inLobby
      ? t('CZEKAMY NA EKIPĘ')
      : t('OKRĄŻENIE {lap}/{total} · RUNDA {round}', {
          lap: state.lap,
          total: state.lapLimit,
          round: state.round,
        });
    const nowDead = !car.alive && (state.phase === 'racing' || summaryPending);
    $('#knockout').hidden = !nowDead;
    if (nowDead && !dead) {
      reset();
      navigator.vibrate?.([100, 60, 100]);
    }
    dead = nowDead;
    $('#pad-countdown').hidden = state.phase !== 'countdown';
    $('#pad-countdown').textContent = String(Math.ceil(state.seconds));
    if (state.phase !== 'racing') reset();
  };
  socket.on('state', render);
  onLanguageChange(() => {
    $('#pad-connection').textContent = socket.connected ? t('Połączono') : t('Brak połączenia');
    if (latest) render(latest);
  });
  // Wake lock is an enhancement; ordinary HTTP LAN play still works without it.
  const wake = async () => {
    try {
      if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
    } catch {
      /* Optional browser capability; gameplay continues without it. */
    }
  };
  document.addEventListener('pointerdown', () => void wake(), { once: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void wake();
  });
}
