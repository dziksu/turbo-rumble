import { bindTranslations, getLanguage, onLanguageChange, t, translateMessage } from './i18n.ts';
import { MAPS, DEFAULT_SETTINGS, type MapId, type RaceSettings } from '../shared/maps.ts';
import type { Snapshot } from '../shared/types.ts';
import type { HostCommand } from '../shared/protocol.ts';
import type { GameSocket } from './core/network.ts';
import { controllerLobbyMode } from './race-presentation.ts';
import { toast } from './core/dom.ts';

type SettingsIdentity = { host: true } | { playerId: string };

/** One authoritative setup view: inline on the host, a separate dialog on controllers. */
export function roomSettings(
  container: HTMLElement,
  socket: GameSocket,
  identity: SettingsIdentity,
) {
  const host = 'host' in identity;
  const fields = `
    <div class="setup-content">
      <div class="setup-section-heading"><span>WYBIERZ TRASĘ</span><small>3 MAPY</small></div>
      <div class="map-options" role="group" aria-label="Mapa">
        ${Object.entries(MAPS)
          .map(
            ([id, map], index) => `
          <button type="button" class="map-option" data-map="${id}" aria-pressed="false">
            <span class="map-image"><img src="/assets/maps/${id}.png" alt="" width="800" height="450" decoding="async" /><span class="map-number">0${index + 1}</span><span class="map-selected-check" aria-hidden="true">✓</span></span>
            <span class="map-caption"><b>${map.name}</b><span>${map.subtitle}</span></span>
          </button>`,
          )
          .join('')}
      </div>
      <div class="setup-section-heading rules-heading"><span>USTAL ZASADY</span><small>2–8 GRACZY</small></div>
      <div class="setup-rules">
        <label class="setup-rule"><span>Okrążenia</span><span class="rule-control"><select id="room-laps"></select><small>NA WYŚCIG</small></span></label>
        <label class="setup-rule"><span>Punkty do zwycięstwa</span><span class="rule-control"><input id="room-points" type="number" min="6" max="50" step="1" inputmode="numeric" required /><small>PKT</small></span></label>
      </div>
      <div class="setup-footer"><span class="setup-sync" id="settings-sync" role="status"></span><p id="settings-hint"></p></div>
    </div>`;
  container.classList.toggle('host-room-settings', host);
  container.innerHTML = host
    ? `<section class="race-setup" aria-labelledby="setup-title"><div class="setup-header"><p class="eyebrow">LOBBY / USTAWIENIA WYŚCIGU</p><h1 id="setup-title">Twój wyścig. <span>Twoje zasady.</span></h1><p>Wybierz scenerię rozróby. Cała ekipa widzi te same ustawienia.</p></div>${fields}</section>`
    : `<button class="button pad-config-button" id="open-settings" type="button" aria-haspopup="dialog"><span aria-hidden="true">⚙</span><span id="settings-button-label">Konfiguracja</span></button>
      <dialog class="controller-settings-dialog" id="controller-settings" aria-labelledby="settings-dialog-title" aria-describedby="settings-dialog-help">
        <header class="controller-settings-header"><div><span id="admin-badge"></span><h2 id="settings-dialog-title">Ustawienia spotkania</h2><p id="settings-feedback" role="alert" hidden></p></div><button id="close-settings" type="button" aria-label="Zamknij" autofocus>×</button></header>
        <main class="controller-settings-content"><p id="settings-dialog-help">Ustaw trasę, zasady i boty. Zmiany widzi cała ekipa.</p>${fields}
          <section class="controller-bots" id="controller-bots" aria-labelledby="settings-bots-title"><div class="settings-bots-heading"><h3 id="settings-bots-title">Boty w pokoju</h3><button class="button subtle" id="admin-bot" type="button">+ Bot</button></div><p id="settings-bots-count"></p><div id="settings-bot-list"></div></section>
          <div class="settings-admin-tools"><button class="button subtle" id="admin-lobby" type="button">Wróć do lobby</button></div>
        </main>
      </dialog>`;
  bindTranslations(container);
  const maps = [...container.querySelectorAll<HTMLButtonElement>('.map-option')],
    laps = container.querySelector<HTMLSelectElement>('#room-laps')!,
    points = container.querySelector<HTMLInputElement>('#room-points')!,
    hint = container.querySelector<HTMLElement>('#settings-hint')!,
    sync = container.querySelector<HTMLElement>('#settings-sync')!,
    dialog = container.querySelector<HTMLDialogElement>('#controller-settings'),
    openButton = container.querySelector<HTMLButtonElement>('#open-settings'),
    feedback = container.querySelector<HTMLElement>('#settings-feedback');
  for (let i = 1; i <= 9; i++) laps.add(new Option(String(i), String(i)));
  let latest: Snapshot | null = null,
    signature = '',
    botSignature = '',
    pointsDraft = false,
    saving = false,
    pending: RaceSettings | null = null;
  const clearError = () => {
    if (feedback) {
      feedback.hidden = true;
      feedback.dataset.source = '';
    }
  };
  const reportError = (message: string) => {
    if (feedback && dialog?.open) {
      feedback.dataset.source = message;
      feedback.textContent = translateMessage(message);
      feedback.hidden = false;
    } else toast(message);
  };
  const canEdit = (state: Snapshot) =>
    host || ('playerId' in identity && state.adminId === identity.playerId);
  const render = (state: Snapshot) => {
    latest = state;
    if (feedback?.dataset.source) feedback.textContent = translateMessage(feedback.dataset.source);
    const inLobby = host ? state.phase === 'lobby' : controllerLobbyMode(state);
    if (!inLobby && dialog?.open) dialog.close();
    container.hidden = !inLobby;
    const settings = state.settings ?? DEFAULT_SETTINGS,
      editable = canEdit(state) && inLobby,
      next = JSON.stringify(settings);
    if (next !== signature) pointsDraft = false;
    const display = pending ?? settings;
    if (pending || !pointsDraft) points.value = String(display.winningScore);
    laps.value = String(display.lapLimit);
    signature = next;
    for (const map of maps) {
      const selected = map.dataset.map === display.mapId;
      map.setAttribute('aria-pressed', String(selected));
      map.classList.toggle('selected', selected);
      map.disabled = !editable || saving || !socket.connected;
    }
    for (const field of [laps, points]) field.disabled = !editable || saving || !socket.connected;
    sync.textContent = saving
      ? t('Zapisywanie…')
      : !socket.connected
        ? t('Łączenie…')
        : t('Widoczne dla całej ekipy');
    sync.classList.toggle('saving', saving || !socket.connected);
    const name = state.cars.find((car) => car.id === state.adminId)?.name ?? t('pierwszy gracz');
    hint.textContent = !canEdit(state)
      ? t('Host lub {name} może zmienić zasady.', { name })
      : t('Zmiany zapisują się automatycznie i cofają gotowość graczy.');
    if (!host) {
      const admin = canEdit(state),
        botButton = container.querySelector<HTMLButtonElement>('#admin-bot')!,
        lobby = container.querySelector<HTMLButtonElement>('#admin-lobby')!,
        botList = container.querySelector<HTMLElement>('#settings-bot-list')!,
        bots = state.cars.filter((car) => car.bot);
      container.querySelector('#settings-button-label')!.textContent = admin
        ? t('Konfiguracja')
        : t('Trasa i zasady');
      container.querySelector('#admin-badge')!.textContent = admin ? 'ADMIN' : t('Podgląd');
      container.querySelector('#settings-dialog-help')!.textContent = admin
        ? t('Ustaw trasę, zasady i boty. Zmiany widzi cała ekipa.')
        : t('Ustawieniami zarządza {name}.', { name });
      container.querySelector<HTMLElement>('#controller-bots')!.hidden = !admin;
      container.querySelector('#settings-bots-count')!.textContent = t(
        'Boty: {count} · Miejsca: {players}/8',
        { count: bots.length, players: state.cars.length },
      );
      botButton.disabled = !editable || saving || state.cars.length >= 8 || !socket.connected;
      lobby.hidden = !admin || state.phase !== 'finished';
      lobby.disabled = !editable || saving || !socket.connected;
      const nextBots =
        `${getLanguage()}:${admin}:` + bots.map((bot) => `${bot.id}:${bot.name}`).join('|');
      if (nextBots !== botSignature) {
        botSignature = nextBots;
        botList.replaceChildren();
        for (const bot of bots) {
          const row = document.createElement('div');
          row.className = 'settings-bot-row';
          const badge = document.createElement('span');
          badge.className = 'settings-bot-avatar';
          badge.style.background = bot.color;
          badge.textContent = String(bot.slot + 1);
          const name = document.createElement('b');
          name.textContent = bot.name;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'button remove-bot-button';
          remove.textContent = t('Usuń');
          remove.setAttribute('aria-label', t('Usuń bota {name}', { name: bot.name }));
          remove.onclick = () => void runCommand({ action: 'remove', id: bot.id });
          row.append(badge, name, remove);
          botList.append(row);
        }
        if (!bots.length) {
          const empty = document.createElement('p');
          empty.className = 'settings-bots-empty';
          empty.textContent = t('Brak botów. Dodaj rywali do wyścigu.');
          botList.append(empty);
        }
      }
      for (const remove of botList.querySelectorAll<HTMLButtonElement>('button'))
        remove.disabled = !editable || saving || !socket.connected;
    }
  };
  const runCommand = async (command: HostCommand) => {
    if (!latest || saving || !socket.connected || !canEdit(latest) || !controllerLobbyMode(latest))
      return;
    clearError();
    saving = true;
    render(latest);
    try {
      const result = await socket.timeout(3000).emitWithAck('host', command);
      if (!result.ok) reportError(result.error);
    } catch {
      reportError('Nie udało się połączyć z pokojem.');
    } finally {
      saving = false;
      if (latest) render(latest);
    }
  };
  const save = async (patch: Partial<RaceSettings>) => {
    if (
      !latest ||
      saving ||
      !socket.connected ||
      !canEdit(latest) ||
      !(host ? latest.phase === 'lobby' : controllerLobbyMode(latest))
    )
      return;
    const settings = { ...(latest.settings ?? DEFAULT_SETTINGS), ...patch };
    if (JSON.stringify(settings) === signature) {
      pointsDraft = false;
      render(latest);
      return;
    }
    clearError();
    saving = true;
    pending = settings;
    render(latest);
    try {
      const result = await socket
        .timeout(3000)
        .emitWithAck('host', { action: 'settings', settings });
      if (!result.ok) throw new Error(result.error);
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      saving = pointsDraft = false;
      pending = null;
      if (latest) render(latest);
    }
  };
  for (const map of maps) map.onclick = () => void save({ mapId: map.dataset.map as MapId });
  laps.onchange = () => void save({ lapLimit: Number(laps.value) });
  points.oninput = () => {
    pointsDraft = true;
  };
  points.onchange = () => {
    if (points.reportValidity()) void save({ winningScore: Number(points.value) });
  };
  points.onkeydown = (event) => {
    if (event.key === 'Enter') points.blur();
  };
  if (dialog && openButton) {
    openButton.onclick = () => {
      if (latest && controllerLobbyMode(latest) && !dialog.open) {
        clearError();
        dialog.showModal();
      }
    };
    container.querySelector<HTMLButtonElement>('#close-settings')!.onclick = () => dialog.close();
    container.querySelector<HTMLButtonElement>('#admin-bot')!.onclick = () =>
      void runCommand({ action: 'bot' });
    container.querySelector<HTMLButtonElement>('#admin-lobby')!.onclick = () =>
      void runCommand({ action: 'lobby' });
  }
  const refresh = () => {
    if (latest) render(latest);
  };
  onLanguageChange(refresh);
  socket.on('connect', refresh);
  socket.on('disconnect', refresh);
  return render;
}
