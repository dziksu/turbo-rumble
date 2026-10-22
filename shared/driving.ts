import { CATCH_UP } from './catch-up.ts';

export const DRIVING = {
  speed: 19,
  nitroMultiplier: 1.35,
  turnRate: 3.3,
  driftSpeed: 10,
  driftBuild: 5,
  driftRecovery: 9,
  acceleration: 13,
  steeringResponse: 24,
} as const;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function drivingTargetSpeed(brake: boolean, boost: boolean, frozen: boolean, catchUp = 0) {
  if (brake) return 0;
  const multiplier = boost
    ? DRIVING.nitroMultiplier
    : frozen
      ? 1
      : 1 + CATCH_UP.maxSpeedBonus * clamp(catchUp, 0, 1);
  return DRIVING.speed * (frozen ? 0.55 : 1) * multiplier;
}

interface DrivingState {
  steering: number;
  drift: number;
  grounded: boolean;
}
interface DrivingInput {
  turn: number;
  brake: boolean;
  boost: boolean;
  frozen: boolean;
  hit: boolean;
}

/** Button input becomes progressive steering and tyre slip; never follows a human's racing line. */
export function drivingControl(
  speedForward: number,
  state: DrivingState,
  input: DrivingInput,
  dt: number,
  catchUp = 0,
) {
  const { brake, boost, frozen, hit } = input;
  const turn = brake ? 0 : input.turn;
  const steering =
    state.steering + (turn - state.steering) * (1 - Math.exp(-DRIVING.steeringResponse * dt));
  const powerSlide =
    state.grounded &&
    !hit &&
    !frozen &&
    !brake &&
    turn !== 0 &&
    turn * state.steering >= 0 &&
    Math.abs(speedForward) > DRIVING.driftSpeed;
  let drift =
    state.drift +
    ((powerSlide ? 1 : 0) - state.drift) *
      (1 - Math.exp(-(powerSlide ? DRIVING.driftBuild : DRIVING.driftRecovery) * dt));
  if (drift < 0.01) drift = 0;
  const target = drivingTargetSpeed(brake, boost, frozen, catchUp);
  return {
    steering,
    drift,
    acceleration: clamp((target - speedForward) * 3.5, -22, boost ? 20 : DRIVING.acceleration),
    yawRate:
      steering * DRIVING.turnRate * clamp(Math.abs(speedForward) / 7, 0.25, 1) * (frozen ? 0.6 : 1),
  };
}
