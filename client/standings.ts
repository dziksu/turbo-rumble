import type { CarState } from '../shared/types.ts';

/** Points decide the scoreboard. A fixed player slot keeps ties still while cars overtake. */
export function rankStandings<T extends Pick<CarState, 'score' | 'slot'>>(cars: readonly T[]): T[] {
  return [...cars].sort((a, b) => b.score - a.score || a.slot - b.slot);
}
