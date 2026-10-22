import { app } from '../core/dom.ts';
import {
  ACTIVITY_RANGES,
  isActivityHistory,
  type ActivityHistory,
  type ActivityRange,
} from '../../shared/activity.ts';
import '../stats.css';

const dateTime = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const axisTime = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const hourTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  hour: '2-digit',
  hourCycle: 'h23',
});

function timeline(data: ActivityHistory) {
  const left = 48,
    right = 970,
    top = 24,
    bottom = 242;
  const start =
    Math.floor((data.generatedAt - ACTIVITY_RANGES[data.range] * 3_600_000) / data.bucketMs) *
    data.bucketMs;
  const maximum = Math.max(4, Math.ceil(Math.max(...data.points.map((p) => p.players), 0) / 4) * 4);
  const x = (at: number) => left + ((at - start) / (data.generatedAt - start)) * (right - left);
  const y = (count: number) => bottom - (count / maximum) * (bottom - top);
  let svg = '';
  for (let i = 0; i <= 4; i++) {
    const value = (maximum * i) / 4;
    svg += `<line class="stats-gridline" x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${value}</text>`;
    const at = start + ((data.generatedAt - start) * i) / 4;
    svg += `<text x="${x(at)}" y="278" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${axisTime.format(at)}</text>`;
  }
  for (const [key, className] of [
    ['players', 'stats-online-line'],
    ['playingPlayers', 'stats-playing-line'],
  ] as const) {
    let path = '',
      previous = -Infinity;
    for (const point of data.points) {
      const connected = point.at - previous === data.bucketMs;
      path += `${connected ? 'L' : 'M'}${x(point.at).toFixed(2)},${y(point[key]).toFixed(2)} `;
      previous = point.at;
    }
    svg += `<path class="${className}" d="${path}"/>`;
  }
  // Individual buckets remain inspectable, including a lone first observation.
  for (const point of data.points) {
    svg += `<circle class="stats-point" cx="${x(point.at)}" cy="${y(point.players)}" r="3"><title>${axisTime.format(point.at)} · online: ${point.players} · w rozgrywce: ${point.playingPlayers}</title></circle>`;
  }
  return `<svg viewBox="0 0 1000 300" role="img" aria-label="Historia maksymalnej liczby graczy online i w rozgrywce"><title>Liczba graczy w czasie. Luki oznaczają brak zapisanych pomiarów.</title>${svg}</svg>`;
}

function hourly(data: ActivityHistory) {
  const hours = Array.from({ length: 24 }, () => ({ players: 0, observed: false }));
  for (const point of data.points) {
    const bucket = hours[Number(hourTime.format(point.at))];
    bucket.players = Math.max(bucket.players, point.players);
    bucket.observed = true;
  }
  const max = Math.max(1, ...hours.map((h) => h.players));
  return `<svg viewBox="0 0 1000 226" role="img" aria-label="Szczyt graczy online według godziny w Warszawie"><title>Maksimum graczy online dla każdej godziny w wybranym okresie</title>${hours
    .map((hour, i) => {
      const x = 30 + i * 40;
      const height = (hour.players / max) * 148;
      return `<rect class="${hour.observed ? 'stats-hour-bar' : 'stats-hour-missing'}" x="${x}" y="${174 - Math.max(2, height)}" width="26" height="${Math.max(2, height)}" rx="4"><title>${i}:00–${i}:59 · ${hour.observed ? `${hour.players} graczy online` : 'brak pomiarów'}</title></rect><text x="${x + 13}" y="${162 - height}" text-anchor="middle">${hour.observed ? hour.players : '—'}</text><text x="${x + 13}" y="205" text-anchor="middle">${String(i).padStart(2, '0')}</text>`;
    })
    .join('')}</svg>`;
}

export function statsPage() {
  document.body.className = 'stats-page';
  document.documentElement.lang = 'pl';
  document.title = 'Aktywność graczy — Turbo Rumble';
  app.innerHTML = `<main class="activity-dashboard">
    <header class="activity-header"><div><p class="stats-eyebrow">TURBO RUMBLE / DANE ZBIORCZE</p><h1>Aktywność graczy</h1></div>
      <label class="stats-range">Zakres<select aria-label="Zakres statystyk"><option value="24h">Ostatnie 24 godziny</option><option value="7d">Ostatnie 7 dni</option><option value="30d">Ostatnie 30 dni</option></select></label>
    </header>
    <p class="activity-status" role="status" aria-live="polite">Ładowanie danych…</p>
    <div class="stats-content" hidden>
      <section class="activity-cards" aria-label="Podsumowanie">
        <article><h2>Gracze online teraz</h2><strong data-value="online">—</strong><p>Połączone kontrolery ludzi</p></article>
        <article><h2>W rozgrywce teraz</h2><strong data-value="playing">—</strong><p>Odliczanie, wyścig lub runda</p></article>
        <article><h2>Szczyt w wybranym okresie</h2><strong data-value="period-peak">—</strong><p data-value="period-time">—</p></article>
        <article><h2>Rekord od początku pomiarów</h2><strong data-value="peak">—</strong><p data-value="peak-time">—</p></article>
      </section>
      <section class="activity-chart"><div class="stats-chart-heading"><div><h2>Gracze w czasie</h2><p data-value="resolution"></p></div><div class="stats-legend"><span>Online</span><span>W rozgrywce</span></div></div><div data-chart="timeline"></div><p class="stats-note">Wartości to maksima w przedziałach czasu. Luki oznaczają brak pomiarów.</p></section>
      <section class="activity-chart"><div class="stats-chart-heading"><div><h2>O której jest największy ruch?</h2><p>Szczyt online według godziny · Europe/Warsaw</p></div></div><div data-chart="hourly"></div></section>
      <section class="activity-chart"><h2>Największe szczyty w okresie</h2><div class="stats-table-wrap"><table><thead><tr><th scope="col">Czas szczytu</th><th scope="col">Online</th><th scope="col">W rozgrywce*</th><th scope="col">Aktywne pokoje*</th></tr></thead><tbody></tbody></table></div><p class="stats-note">* Maksima w tym samym przedziale; nie muszą wystąpić w tej samej sekundzie.</p></section>
      <p class="stats-footnote" data-value="coverage"></p>
    </div>
  </main>`;
  const select = app.querySelector<HTMLSelectElement>('select')!;
  const status = app.querySelector<HTMLElement>('.activity-status')!;
  const content = app.querySelector<HTMLElement>('.stats-content')!;
  const events = new AbortController();
  let range: ActivityRange = '24h';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let suspended = false;
  const set = (key: string, value: string | number) => {
    app.querySelector(`[data-value="${key}"]`)!.textContent = String(value);
  };
  function render(data: ActivityHistory) {
    const peak = data.points.reduce<ActivityHistory['points'][number] | undefined>(
      (best, point) => (!best || point.players > best.players ? point : best),
      undefined,
    );
    set('online', data.current.players);
    set('playing', data.current.playingPlayers);
    set('period-peak', peak?.players ?? '—');
    set(
      'period-time',
      peak && peak.players > 0 ? dateTime.format(peak.peakAt) : 'Brak aktywności w okresie',
    );
    set('peak', data.peak.players);
    set('peak-time', data.peak.at === null ? 'Brak aktywności' : dateTime.format(data.peak.at));
    set(
      'resolution',
      `Maksimum ${data.bucketMs === 60_000 ? 'w każdej minucie' : 'w każdej godzinie'} · czas warszawski`,
    );
    app.querySelector('[data-chart="timeline"]')!.innerHTML = timeline(data);
    app.querySelector('[data-chart="hourly"]')!.innerHTML = hourly(data);
    const peaks = [...data.points]
      .filter((p) => p.players > 0)
      .sort((a, b) => b.players - a.players || a.peakAt - b.peakAt)
      .slice(0, 5);
    app.querySelector('tbody')!.innerHTML = peaks.length
      ? peaks
          .map(
            (point) =>
              `<tr><td>${dateTime.format(point.peakAt)}</td><td>${point.players}</td><td>${point.playingPlayers}</td><td>${point.activeRooms}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4">Brak aktywności w wybranym okresie.</td></tr>';
    set(
      'coverage',
      `Pomiary od ${dateTime.format(data.startedAt)}. Historia: do 90 dni, rekord zachowywany bezterminowo. Bez botów i ekranów hosta w liczbie graczy. Zapisywane są wyłącznie liczby i czas.`,
    );
    content.hidden = false;
    status.dataset.state = 'ready';
    status.textContent = `Aktualizacja: ${dateTime.format(data.generatedAt)} · odświeżanie co 15 s`;
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
      const response = await fetch(`/api/stats/history?range=${range}`, {
        cache: 'no-store',
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) throw new Error('Activity unavailable');
      const data: unknown = await response.json();
      if (!isActivityHistory(data) || data.range !== range) throw new Error('Invalid activity');
      if (!current.signal.aborted) render(data);
    } catch {
      if (!current.signal.aborted) {
        status.dataset.state = 'error';
        status.textContent =
          'Nie udało się odświeżyć danych. Widoczne dane mogą być nieaktualne. Ponowna próba za 15 s.';
      }
    } finally {
      if (request === current) {
        request = undefined;
        if (!events.signal.aborted && !suspended && !document.hidden)
          timer = setTimeout(() => void refresh(), 15_000);
      }
    }
  }
  const refreshNow = () => void refresh();
  select.addEventListener(
    'change',
    () => {
      range = select.value as ActivityRange;
      content.hidden = true;
      status.textContent = 'Ładowanie danych…';
      refreshNow();
    },
    { signal: events.signal },
  );
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
  const dispose = () => {
    pause();
    events.abort();
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
  refreshNow();
}
