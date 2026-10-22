import { isServerStats, type ServerStats } from '../shared/protocol.ts';
import { onLanguageChange, t } from './i18n.ts';

export function mountServerStats(root: HTMLElement) {
  const panel = root.querySelector<HTMLElement>('.server-stats')!;
  const counts = panel.querySelector<HTMLElement>('.server-counts')!;
  const error = panel.querySelector<HTMLElement>('.server-stats-error')!;
  const status = panel.querySelector<HTMLElement>('[data-stat-status]')!;
  const events = new AbortController();
  let stats: ServerStats | undefined;
  let failed = false,
    suspended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;

  function render() {
    panel.setAttribute('aria-label', t('Statystyki serwera'));
    panel.dataset.state = failed
      ? 'unavailable'
      : !stats
        ? 'loading'
        : stats.rooms >= stats.maxRooms
          ? 'full'
          : 'online';
    panel.querySelector('[data-stat-label="players"]')!.textContent = t('Graczy online');
    panel.querySelector('[data-stat-label="activeRooms"]')!.textContent = t('Aktywne pokoje');
    panel.querySelector('[data-stat-label="rooms"]')!.textContent = t('Pokoje / limit');
    panel.querySelector<HTMLElement>('[data-stat-label="players"]')!.parentElement!.title = t(
      'Połączeni gracze, bez botów i ekranów hosta.',
    );
    panel.querySelector<HTMLElement>('[data-stat-label="activeRooms"]')!.parentElement!.title = t(
      'Pokoje z połączonym ekranem hosta lub graczem.',
    );
    panel.querySelector<HTMLElement>('[data-stat-label="rooms"]')!.parentElement!.title = t(
      'Utworzone pokoje / limit serwera. Puste pokoje zajmują miejsce do wygaśnięcia.',
    );
    panel.querySelector('[data-stat="players"]')!.textContent = stats ? String(stats.players) : '—';
    panel.querySelector('[data-stat="activeRooms"]')!.textContent = stats
      ? String(stats.activeRooms)
      : '—';
    panel.querySelector('[data-stat="rooms"]')!.textContent = stats
      ? `${stats.rooms} / ${stats.maxRooms}`
      : '— / —';
    counts.hidden = failed;
    error.hidden = !failed;
    error.textContent = t('Statystyki chwilowo niedostępne');
    const message = t(
      failed
        ? 'Statystyki chwilowo niedostępne'
        : !stats
          ? 'Sprawdzanie serwera…'
          : stats.rooms >= stats.maxRooms
            ? 'Limit pokojów osiągnięty'
            : 'Serwer online',
    );
    panel.title = message;
    if (status.textContent !== message) status.textContent = message;
  }
  function pause() {
    clearTimeout(timer);
    request?.abort();
    request = undefined;
  }
  async function refresh() {
    pause();
    if (events.signal.aborted || suspended || document.hidden) return;
    const current = new AbortController();
    request = current;
    try {
      const response = await fetch('/api/stats', {
        cache: 'no-store',
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) throw new Error('Stats unavailable');
      const value: unknown = await response.json();
      if (!isServerStats(value)) throw new Error('Invalid stats');
      if (current.signal.aborted) return;
      stats = value;
      failed = false;
      render();
    } catch {
      if (current.signal.aborted) return;
      stats = undefined;
      failed = true;
      render();
    } finally {
      if (request === current) {
        request = undefined;
        if (!events.signal.aborted && !suspended && !document.hidden)
          timer = setTimeout(() => void refresh(), 15_000);
      }
    }
  }
  const refreshNow = () => void refresh();
  document.addEventListener('visibilitychange', refreshNow, { signal: events.signal });
  window.addEventListener('online', refreshNow, { signal: events.signal });
  window.addEventListener(
    'pageshow',
    () => {
      suspended = false;
      refreshNow();
    },
    { signal: events.signal },
  );
  const stopLanguage = onLanguageChange(render);
  const dispose = () => {
    pause();
    events.abort();
    stopLanguage();
  };
  window.addEventListener(
    'pagehide',
    (event) => {
      suspended = true;
      pause();
      if (!event.persisted) dispose();
    },
    { signal: events.signal },
  );
  import.meta.hot?.dispose(dispose);
  render();
  refreshNow();
}
