import type { Result } from '../shared/types.ts';
import { t } from './i18n.ts';

/** Use the server's places; score ties may have been resolved by race progress. */
export function resultsPodium(results: readonly Result[]) {
  const board = document.createElement('div');
  board.className = 'results-board';
  const podium = document.createElement('ol');
  podium.className = 'podium';
  podium.setAttribute('aria-label', t('Podium'));
  const remaining = document.createElement('ol');
  remaining.className = 'result-list';
  remaining.start = 4;
  remaining.setAttribute('aria-label', t('Pozostałe miejsca'));
  for (const result of [...results].sort((a, b) => a.place - b.place)) {
    const row = document.createElement('li');
    const top = result.place <= 3;
    row.className = top ? 'podium-place' : 'result-row';
    row.dataset.place = String(result.place);
    row.value = result.place;
    row.style.setProperty('--car-color', result.color);
    const place = document.createElement('b');
    place.className = 'result-place';
    place.textContent = String(result.place).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'result-name';
    name.textContent = result.name;
    const score = document.createElement('strong');
    score.className = 'result-score';
    score.textContent = result.score + ' ' + t('PKT');
    if (top) {
      const medal = document.createElement('span');
      medal.className = 'podium-medal';
      medal.setAttribute('aria-hidden', 'true');
      medal.textContent = result.place === 1 ? '★' : '◆';
      row.append(medal);
    }
    row.append(place, name, score);
    (top ? podium : remaining).append(row);
  }
  board.append(podium);
  if (remaining.childElementCount) board.append(remaining);
  return board;
}
