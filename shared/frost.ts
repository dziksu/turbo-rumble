import type { Car } from './entities.ts';
import { bodyYaw } from './physics-utils.ts';
import { FROST_DURATION_TICKS } from './rules.ts';

/** Freeze driver controls, never the Rapier body: impacts and gravity stay authoritative. */
export function applyFrost(car: Car, tick: number) {
  if (!car.alive || car.invulnerableUntil > tick) return false;
  if (car.frostUntil <= tick || car.frostSpeed === null) {
    const velocity = car.body.linvel(),
      yaw = bodyYaw(car.body);
    const forwardSpeed = velocity.x * Math.sin(yaw) + velocity.z * Math.cos(yaw);
    car.frostSpeed = Math.hypot(velocity.x, velocity.z) * (forwardSpeed < 0 ? -1 : 1);
  }
  car.frostUntil = tick + FROST_DURATION_TICKS;
  car.steering = car.drift = car.reverseHold = car.catchUp = 0;
  car.reversing = false;
  return true;
}
