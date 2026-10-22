import { clamp } from './physics-utils.ts';

export const CATCH_UP = {
  startGap: 6,
  fullGap: 10,
  maxSpeedBonus: 0.16,
  riseRate: 3.5,
  fadeRate: 5,
} as const;

// Progress is unwrapped distance along the road, so adjacent laps and hairpins stay correct.
export function catchUpTarget(gap: number): number {
  const fraction = clamp((gap - CATCH_UP.startGap) / (CATCH_UP.fullGap - CATCH_UP.startGap), 0, 1);
  return fraction * fraction * (3 - 2 * fraction);
}

export function updateCatchUp(
  previous: number,
  gap: number,
  eligible: boolean,
  dt: number,
): number {
  if (!eligible) return 0;
  const target = catchUpTarget(gap);
  const rate = target > previous ? CATCH_UP.riseRate : CATCH_UP.fadeRate;
  const strength = previous + (target - previous) * (1 - Math.exp(-rate * dt));
  return target === 0 && strength < 0.001 ? 0 : clamp(strength, 0, 1);
}
