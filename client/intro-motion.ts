export const INTRO_LOOP_SECONDS = 16;

/** A closed stunt loop that slows near the airborne part, without a visible reset. */
export function introPose(seconds: number, actor: number) {
  const cycle = (((seconds / INTRO_LOOP_SECONDS + actor / 3) % 1) + 1) % 1;
  const angle = cycle * Math.PI * 2;
  const phase = angle + Math.sin(angle) * 0.48;
  const x = Math.sin(phase) * 3.1,
    z = Math.cos(phase) * 2.2,
    y = (1 - Math.cos(phase)) * 1.8 + 0.06;
  return {
    x,
    y,
    z,
    yaw: Math.atan2(3.1 * Math.cos(phase), -2.2 * Math.sin(phase)),
    pitch:
      -Math.atan2(1.8 * Math.sin(phase), Math.hypot(3.1 * Math.cos(phase), 2.2 * Math.sin(phase))) *
      0.75,
    roll: Math.sin(phase) * 0.16,
  };
}
