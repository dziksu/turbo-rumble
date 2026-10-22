import type { Snapshot } from '../shared/types.ts';

/** Server time keeps the last impact visible across reconnects and language changes. */
export function waitingForSummary(state: Pick<Snapshot, 'phase' | 'tick' | 'summaryAt'>) {
  return (state.phase === 'segment' || state.phase === 'finished') && state.tick < state.summaryAt;
}
