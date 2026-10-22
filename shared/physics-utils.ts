import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import type { Vec } from './types.ts';
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const v3 = (v: Vec) => new Vector3(v.x, v.y, v.z);
export function bodyYaw(body: RAPIER.RigidBody) {
  const q = body.rotation();
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
}
