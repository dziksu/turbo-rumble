import { CATCH_UP } from './catch-up.ts';

export const DRIVING = {
  speed: 22,
  linearDamping: 0.1,
  nitroMultiplier: 1.35,
  turnRate: 3.3,
  driftSpeed: 10,
  driftBuild: 5,
  driftRecovery: 9,
  acceleration: 15,
  nitroAcceleration: 24,
  steeringResponse: 24,
  reverseHoldSeconds: 0.4,
  reverseEntrySpeed: 0.8,
  reverseSpeed: 5,
  reverseAcceleration: 6,
} as const;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function drivingTargetSpeed(brake: boolean, boost: boolean, frozen: boolean, catchUp = 0) {
  if (brake) return 0;
  const multiplier = frozen
    ? 1
    : boost
      ? DRIVING.nitroMultiplier
      : 1 + CATCH_UP.maxSpeedBonus * clamp(catchUp, 0, 1);
  return DRIVING.speed * multiplier;
}

interface DrivingState {
  steering: number;
  drift: number;
  grounded: boolean;
  reverseHold: number;
  reversing: boolean;
}
interface DrivingInput {
  speed: number;
  turn: number;
  brake: boolean;
  boost: boolean;
  frozen: boolean;
  frozenSpeed?: number;
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
  if (frozen) {
    const target = input.frozenSpeed ?? speedForward;
    return {
      steering: 0,
      drift: 0,
      reverseHold: 0,
      reversing: false,
      brake: false,
      // Wheel forces maintain the captured speed and compensate chassis drag.
      // No velocity/pose writes: walls, airborne motion and weapon impulses still win.
      acceleration: clamp(
        (target - speedForward) * 3.5 + target * DRIVING.linearDamping,
        -22,
        DRIVING.acceleration,
      ),
      yawRate: 0,
    };
  }
  // Hold at a near stop before engaging reverse; keep that gear until release.
  // Sideways motion and airborne/impact frames must not count as a stopped car.
  const mayReverse = brake && state.grounded && !hit;
  const reverseHold = mayReverse
    ? state.reversing
      ? state.reverseHold
      : input.speed <= DRIVING.reverseEntrySpeed
        ? Math.min(DRIVING.reverseHoldSeconds, state.reverseHold + dt)
        : 0
    : 0;
  const reversing = mayReverse && (state.reversing || reverseHold >= DRIVING.reverseHoldSeconds);
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
  const assistance =
    !brake && !boost && !frozen && !hit && state.grounded ? clamp(catchUp, 0, 1) : 0;
  const target = reversing
    ? -DRIVING.reverseSpeed
    : drivingTargetSpeed(brake, boost, frozen, assistance);
  return {
    steering,
    drift,
    reverseHold,
    reversing,
    brake: brake && !reversing,
    acceleration: clamp(
      (target - speedForward) * 3.5,
      reversing ? -DRIVING.reverseAcceleration : -22,
      reversing
        ? DRIVING.reverseAcceleration
        : boost
          ? DRIVING.nitroAcceleration
          : DRIVING.acceleration * (1 + CATCH_UP.maxAccelerationBonus * assistance),
    ),
    yawRate: steering * DRIVING.turnRate * clamp(Math.abs(speedForward) / 7, 0.25, 1),
  };
}
