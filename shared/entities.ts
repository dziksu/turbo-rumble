import type RAPIER from '@dimforge/rapier3d-compat';
import type { VehiclePhysics } from './vehicle.ts';
import type { Input, ProjectileState, Weapon, Vec } from './types.ts';
export interface Driver {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  connected: boolean;
  ready: boolean;
  wins: number;
}
export interface Car extends Driver {
  body: RAPIER.RigidBody;
  vehicle: VehiclePhysics;
  score: number;
  alive: boolean;
  progress: number;
  weapon: Weapon | null;
  boostUntil: number;
  frostUntil: number;
  invulnerableUntil: number;
  outsideTicks: number;
  lastInputTick: number;
  input: Input;
  usedAction: number;
  hitUntil: number;
  wreckUntil: number;
  steering: number;
  drift: number;
  grounded: boolean;
  reverseHold: number;
  reversing: boolean;
  catchUp: number;
}
export interface Shot extends ProjectileState {
  born: number;
  expires: number;
  velocity: Vec;
  travelled: number;
  body?: RAPIER.RigidBody;
}
