import type { Snapshot } from '../shared/types.ts';
import type { HostCommand } from '../shared/protocol.ts';
import type { GameSocket } from './core/network.ts';
import { bindTranslations, onLanguageChange, t, translateMessage } from './i18n.ts';

type AdminIdentity = { host: true } | { playerId: string };

/** Room administration remains available throughout the match. */
export function roomAdmin(container: HTMLElement, socket: GameSocket, identity: AdminIdentity) {
  container.innerHTML = `
    <button class="button subtle" id="open-admin" type="button" aria-haspopup="dialog">Administracja pokoju</button>
    <dialog class="room-admin-dialog" aria-labelledby="room-admin-title">
      <div class="room-admin-heading"><h2 id="room-admin-title">Administracja pokoju</h2><button class="icon-button" id="close-admin" type="button" aria-label="Zamknij">×</button></div>
      <p id="room-admin-current"></p>
      <p id="room-admin-error" role="alert" hidden></p>
      <label for="admin-successor">Przekaż administratora</label>
      <select id="admin-successor"></select>
      <button class="button" id="transfer-admin" type="button">Przekaż administratora</button>
      <p>Przekazanie roli nie przerywa gry. Nowy administrator przejmuje zarządzanie pokojem.</p>
      <hr />
      <p>Powrót do lobby kończy bieżący mecz dla całej ekipy.</p>
      <button class="button" id="admin-lobby" type="button">Zakończ grę i wróć do lobby</button>
    </dialog>`;
  bindTranslations(container);
  const dialog = container.querySelector<HTMLDialogElement>('dialog')!,
    open = container.querySelector<HTMLButtonElement>('#open-admin')!,
    successor = container.querySelector<HTMLSelectElement>('#admin-successor')!,
    transfer = container.querySelector<HTMLButtonElement>('#transfer-admin')!,
    lobby = container.querySelector<HTMLButtonElement>('#admin-lobby')!,
    error = container.querySelector<HTMLElement>('#room-admin-error')!;
  let latest: Snapshot | null = null,
    pending = false,
    errorMessage = '';
  const permitted = (state: Snapshot) => 'host' in identity || state.adminId === identity.playerId;
  const render = (state: Snapshot) => {
    latest = state;
    const allowed = permitted(state);
    container.hidden = !allowed;
    if (!allowed && dialog.open) dialog.close();
    open.disabled = pending || !socket.connected;
    const selected = successor.value;
    const candidates = state.cars.filter(
      (car) => !car.bot && car.connected && car.id !== state.adminId,
    );
    // Keep the select stable while snapshots arrive, including keyboard focus.
    const options = candidates.map((car) => `${car.id}:${car.name}`).join('|');
    if (successor.dataset.options !== options) {
      successor.dataset.options = options;
      successor.replaceChildren(...candidates.map((car) => new Option(car.name, car.id)));
      if (candidates.some((car) => car.id === selected)) successor.value = selected;
    }
    successor.disabled = pending || !socket.connected || !candidates.length;
    transfer.disabled = successor.disabled;
    lobby.disabled = pending || !socket.connected || state.phase === 'lobby';
    container.querySelector('#room-admin-current')!.textContent = t('Administrator: {name}', {
      name: state.cars.find((car) => car.id === state.adminId)?.name ?? '—',
    });
    error.hidden = !errorMessage;
    error.textContent = errorMessage ? translateMessage(errorMessage) : '';
  };
  const run = async (command: HostCommand) => {
    if (!latest || !permitted(latest) || pending || !socket.connected) return;
    pending = true;
    errorMessage = '';
    render(latest);
    try {
      const result = await socket.timeout(3000).emitWithAck('host', command);
      if (!result.ok) errorMessage = result.error;
      else dialog.close();
    } catch {
      errorMessage = 'Nie udało się połączyć z pokojem.';
    } finally {
      pending = false;
      if (latest) render(latest);
    }
  };
  open.onclick = () => {
    if (latest && permitted(latest) && !dialog.open) {
      errorMessage = '';
      render(latest);
      dialog.showModal();
    }
  };
  container.querySelector<HTMLButtonElement>('#close-admin')!.onclick = () => dialog.close();
  transfer.onclick = () => {
    if (successor.value) void run({ action: 'transfer-admin', id: successor.value });
  };
  lobby.onclick = () => void run({ action: 'lobby' });
  const refresh = () => {
    if (latest) render(latest);
  };
  socket.on('connect', refresh);
  socket.on('disconnect', refresh);
  onLanguageChange(refresh);
  container.hidden = true;
  return render;
}
