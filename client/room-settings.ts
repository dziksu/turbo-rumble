import { bindTranslations, onLanguageChange, t } from './i18n.ts';
import { MAPS, DEFAULT_SETTINGS, type MapId, type RaceSettings } from '../shared/maps.ts';
import type { Snapshot } from '../shared/types.ts';
import type { GameSocket } from './core/network.ts';
import { toast } from './core/dom.ts';

type SettingsIdentity = { host: true } | { playerId: string };

/** One authoritative setup view for the shared screen and every controller. */
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
    : `<details class="room-settings" id="room-settings"><summary><span class="settings-summary-title">Ustawienia spotkania <b id="admin-badge"></b></span><strong id="settings-map-name"></strong><small id="settings-rules"></small></summary>${fields}<div class="settings-admin-tools"><button class="button subtle" id="admin-bot">+ Bot</button><button class="button subtle" id="admin-lobby">Wróć do lobby</button></div></details>`;
  bindTranslations(container);
  const maps = [...container.querySelectorAll<HTMLButtonElement>('.map-option')],
    laps = container.querySelector<HTMLSelectElement>('#room-laps')!,
    points = container.querySelector<HTMLInputElement>('#room-points')!,
    hint = container.querySelector<HTMLElement>('#settings-hint')!,
    sync = container.querySelector<HTMLElement>('#settings-sync')!;
  for (let i = 1; i <= 9; i++) laps.add(new Option(String(i), String(i)));
  let latest: Snapshot | null = null,
    signature = '',
    pointsDraft = false,
    saving = false,
    pending: RaceSettings | null = null;
  const canEdit = (state: Snapshot) =>
    host || ('playerId' in identity && state.adminId === identity.playerId);
  const render = (state: Snapshot) => {
    latest = state;
    const inLobby = (host ? ['lobby'] : ['lobby', 'finished']).includes(state.phase);
    container.hidden = !inLobby;
    if (!inLobby) {
      const details = container.querySelector('details');
      if (details) details.open = false;
    }
    const settings = state.settings ?? DEFAULT_SETTINGS,
      editable = canEdit(state) && ['lobby', 'finished'].includes(state.phase),
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
        bot = container.querySelector<HTMLButtonElement>('#admin-bot')!,
        lobby = container.querySelector<HTMLButtonElement>('#admin-lobby')!;
      container.querySelector('#admin-badge')!.textContent = admin ? 'ADMIN' : '';
      container.querySelector('#settings-map-name')!.textContent = MAPS[settings.mapId].name;
      container.querySelector('#settings-rules')!.textContent = t(
        '{laps} OKRĄŻENIA · DO {points} PKT',
        { laps: settings.lapLimit, points: settings.winningScore },
      );
      bot.hidden = !admin;
      bot.disabled = !editable || saving || state.cars.length >= 8 || !socket.connected;
      lobby.hidden = !admin || state.phase !== 'finished';
    }
  };
  const save = async (patch: Partial<RaceSettings>) => {
    if (
      !latest ||
      saving ||
      !socket.connected ||
      !canEdit(latest) ||
      !['lobby', 'finished'].includes(latest.phase)
    )
      return;
    const settings = { ...(latest.settings ?? DEFAULT_SETTINGS), ...patch };
    if (JSON.stringify(settings) === signature) {
      pointsDraft = false;
      render(latest);
      return;
    }
    saving = true;
    pending = settings;
    render(latest);
    try {
      const result = await socket
        .timeout(3000)
        .emitWithAck('host', { action: 'settings', settings });
      if (!result.ok) throw new Error(result.error);
    } catch (error) {
      toast((error as Error).message);
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
  if (!host) {
    for (const [id, action] of [
      ['#admin-bot', 'bot'],
      ['#admin-lobby', 'lobby'],
    ] as const)
      container.querySelector<HTMLButtonElement>(id)!.onclick = async () => {
        try {
          const result = await socket.timeout(3000).emitWithAck('host', { action });
          if (!result.ok) toast(result.error);
        } catch {
          toast('Nie udało się połączyć z pokojem.');
        }
      };
  }
  const refresh = () => {
    if (latest) render(latest);
  };
  onLanguageChange(refresh);
  socket.on('connect', refresh);
  socket.on('disconnect', refresh);
  return render;
}
