import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { applyFrost } from './frost.ts';
import type { Race } from './simulation.ts';
import type { Car, Shot } from './entities.ts';
import { COLORS, type Vec } from './types.ts';
import {
  PHYSICS_STEP_SECONDS as DT,
  CAR_MASS as MASS,
  NITRO_EXHAUST,
  MINE_OWNER_PROTECTION_TICKS,
  PROJECTILE_RANGE,
  PULSE,
} from './rules.ts';
import { bodyYaw, v3 } from './physics-utils.ts';
export function useWeapon(race: Race, c: Car): void {
  if (!c.alive || !c.weapon || race.phase !== 'racing') return;
  const kind = c.weapon;
  c.weapon = null;
  const p = c.body.translation(),
    yaw = bodyYaw(c.body),
    forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  if (kind === 'boost') {
    c.boostUntil = race.tick + 75;
    race.emit('shot', p, 'NITRO', COLORS[c.slot], kind);
    return;
  }
  if (kind === 'pulse') {
    for (const other of race.cars.values()) {
      if (other.id === c.id || !other.alive || other.invulnerableUntil > race.tick) continue;
      const delta = v3(other.body.translation()).sub(v3(p)),
        dist = delta.length();
      if (dist < PULSE.radius) {
        delta.y = 0;
        if (delta.lengthSq() < 0.01) delta.copy(forward);
        const pushSpeed =
          PULSE.minimumPushSpeed +
          (PULSE.maximumPushSpeed - PULSE.minimumPushSpeed) * (1 - dist / PULSE.radius);
        delta.normalize().multiplyScalar(MASS * pushSpeed);
        other.body.applyImpulse({ x: delta.x, y: MASS * PULSE.liftSpeed, z: delta.z }, true);
        other.hitUntil = Math.max(other.hitUntil, race.tick + PULSE.hitTicks);
        other.catchUp = 0;
      }
    }
    race.emit('pulse', p, 'IMPULS', COLORS[c.slot]);
    return;
  }
  const isMine = kind === 'mine',
    pos = v3(p).addScaledVector(forward, isMine ? -3.1 : 3.1);
  pos.y = isMine ? Math.max(0.4, p.y - 0.15) : Math.max(0.6, p.y + 0.25);
  let body: RAPIER.RigidBody | undefined;
  if (isMine) {
    const velocity = c.body.linvel();
    body = race.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinvel(velocity.x * 0.12, -0.8, velocity.z * 0.12)
        .setLinearDamping(3)
        .setAngularDamping(3)
        .setCcdEnabled(true),
    );
    race.world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.14, 0.7)
        .setMass(6)
        .setFriction(0.9)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(0.15),
      body,
    );
  }
  race.shots.push({
    id: race.nextEntity++,
    kind,
    owner: c.id,
    position: pos,
    yaw,
    armed: true,
    born: race.tick,
    expires: race.tick + (isMine ? 500 : 150),
    velocity: { x: forward.x * (isMine ? 0 : 34), y: 0, z: forward.z * (isMine ? 0 : 34) },
    travelled: 0,
    body,
  });
  race.emit('shot', pos, undefined, COLORS[c.slot], kind);
}
// A short capsule matches the visible jet, with no damage beside or ahead of the car.
const EXHAUST_SHAPE = new RAPIER.Capsule(
  NITRO_EXHAUST.length / 2 - NITRO_EXHAUST.radius,
  NITRO_EXHAUST.radius,
);
const EXHAUST_ROTATION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
export function updateNitroExhaust(race: Race): void {
  if (race.phase !== 'racing') return;
  const victims = new Map<string, { car: Car; backward: Vector3 }>();
  for (const source of race.cars.values()) {
    if (
      !source.alive ||
      source.frostUntil > race.tick ||
      source.boostUntil <= race.tick ||
      race.pendingDeaths.has(source.id)
    )
      continue;
    const rotation = new Quaternion().copy(source.body.rotation()),
      backward = new Vector3(0, 0, -1).applyQuaternion(rotation),
      origin = v3(source.body.translation()),
      centre = origin
        .clone()
        .addScaledVector(backward, NITRO_EXHAUST.rearOffset + NITRO_EXHAUST.length / 2),
      orientation = rotation.multiply(EXHAUST_ROTATION);
    for (const target of race.cars.values()) {
      if (
        target.id === source.id ||
        !target.alive ||
        target.invulnerableUntil > race.tick ||
        race.pendingDeaths.has(target.id) ||
        victims.has(target.id)
      )
        continue;
      const position = v3(target.body.translation());
      if (
        position.distanceToSquared(centre) > 16 ||
        !target.body.collider(0).intersectsShape(EXHAUST_SHAPE, centre, orientation) ||
        race.blastBlocked(origin, position)
      )
        continue;
      victims.set(target.id, { car: target, backward });
    }
  }
  // Resolve together so two boosted cars can burn each other on the same physics tick.
  for (const { car, backward } of victims.values()) {
    car.wreckUntil = race.tick + 70;
    car.body.setEnabledRotations(true, true, true, true);
    car.body.applyImpulse(
      { x: backward.x * MASS * 3, y: MASS * 4, z: backward.z * MASS * 3 },
      true,
    );
    car.body.applyTorqueImpulse(
      { x: backward.z * MASS * 0.8, y: MASS * 0.3, z: -backward.x * MASS * 0.8 },
      true,
    );
    car.hitUntil = race.tick + 30;
    race.eliminate(car.id, 'nitro');
    race.emit('explosion', car.body.translation(), 'NITRO', '#ffad5b', 'boost', 0.35);
  }
}
export function blastBlocked(race: Race, origin: Vector3, target: Vector3): boolean {
  const delta = target.clone().sub(origin),
    distance = delta.length();
  return (
    distance > 0.4 &&
    !!race.world.castRay(
      new RAPIER.Ray(origin, delta.normalize()),
      Math.max(0, distance - 0.3),
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => collider.parent() === null,
    )
  );
}
export function blast(
  race: Race,
  position: Vec,
  kind: 'mine' | 'rocket',
  protectedCarId?: string,
): void {
  const origin = v3(position),
    radius = 7.5;
  for (const car of race.cars.values()) {
    if (!car.alive || car.invulnerableUntil > race.tick || car.id === protectedCarId) continue;
    const delta = v3(car.body.translation()).sub(origin),
      distance = delta.length();
    if (distance >= radius) continue;
    // Fixed concrete and rock colliders shield the blast. Cars and loose props do not.
    if (race.blastBlocked(origin, v3(car.body.translation()))) continue;
    const lethal = distance < 3.1,
      falloff = 1 - distance / radius;
    delta.y = 0;
    if (delta.lengthSq() < 0.01)
      delta.copy(race.track.trackAt(car.progress).n).multiplyScalar(car.slot % 2 ? 1 : -1);
    delta.normalize();
    if (lethal) {
      car.wreckUntil = race.tick + 70;
      car.body.setEnabledRotations(true, true, true, true);
      race.eliminate(car.id, kind === 'mine' ? 'mina' : 'rakieta');
    }
    car.body.applyImpulse(
      {
        x: delta.x * MASS * (3 + 12 * falloff),
        y: MASS * (lethal ? 7 + 3 * falloff : 3 * falloff),
        z: delta.z * MASS * (3 + 12 * falloff),
      },
      true,
    );
    car.body.applyTorqueImpulse(
      {
        x: delta.z * MASS * 2 * falloff,
        y: MASS * 0.7 * falloff,
        z: -delta.x * MASS * 2 * falloff,
      },
      true,
    );
    car.hitUntil = race.tick + 30;
  }
  for (const o of race.track.OBSTACLES) {
    const body = race.obstacleBodies.get(o.id);
    if (!body?.isEnabled()) continue;
    const delta = v3(body.translation()).sub(origin),
      distance = delta.length();
    if (distance >= 9 || race.blastBlocked(origin, v3(body.translation()))) continue;
    const falloff = 1 - distance / 9;
    delta.y = 0;
    delta.normalize();
    body.applyImpulse(
      {
        x: delta.x * o.mass * 19 * falloff,
        y: o.mass * 6 * falloff,
        z: delta.z * o.mass * 19 * falloff,
      },
      true,
    );
    body.applyTorqueImpulse(
      { x: o.mass * 2 * falloff, y: o.mass * 3 * falloff, z: o.mass * falloff },
      true,
    );
  }
  race.emit('explosion', position, undefined, undefined, kind, 1);
}
function finishProjectile(race: Race, shot: Shot, target?: Car): void {
  if (shot.kind === 'frost') {
    if (target) applyFrost(target, race.tick);
    race.emit('frost', shot.position, 'MRÓZ');
  } else {
    // Protection belongs to this rocket, never to the owner's global immunity timer.
    race.blast(shot.position, 'rocket', shot.owner);
  }
}

export function updateShots(race: Race): void {
  const keep: Shot[] = [];
  for (const shot of race.shots) {
    if (shot.expires <= race.tick || shot.position.y < -8) {
      if (shot.kind !== 'mine' && shot.position.y >= -8) finishProjectile(race, shot);
      race.removeShot(shot);
      continue;
    }
    let hit = false;
    if (shot.kind === 'mine') {
      if (shot.body) {
        shot.position = { ...shot.body.translation() };
        shot.rotation = { ...shot.body.rotation() };
      }
      const protectedOwner =
          race.tick - shot.born < MINE_OWNER_PROTECTION_TICKS ? shot.owner : undefined,
        collider = shot.body?.collider(0);
      for (const car of race.cars.values()) {
        if (!car.alive || car.invulnerableUntil > race.tick || car.id === protectedOwner) continue;
        // A small contact tolerance includes surfaces separated by the physics solver.
        if (collider?.contactCollider(car.body.collider(0), 0.03)) {
          race.blast(shot.position, 'mine', protectedOwner);
          hit = true;
          break;
        }
      }
    } else {
      const old = v3(shot.position),
        owner = race.cars.get(shot.owner);
      const range = PROJECTILE_RANGE[shot.kind],
        remaining = Math.max(0, range - shot.travelled),
        speed = v3(shot.velocity).length(),
        duration = speed > 0 ? Math.min(DT, remaining / speed) : DT;
      // Sweep the projectile's volume through the authoritative collider world.
      // This finds the earliest car, barrel or wall even at high projectile speeds.
      const collision = race.world.castShape(
        old,
        { x: 0, y: 0, z: 0, w: 1 },
        shot.velocity,
        new RAPIER.Ball(0.24),
        0,
        duration,
        true,
        undefined,
        undefined,
        undefined,
        owner?.body,
      );
      const next = old
        .clone()
        .addScaledVector(v3(shot.velocity), collision ? collision.time_of_impact : duration);
      shot.position = next;
      shot.travelled = Math.min(range, shot.travelled + old.distanceTo(next));
      if (collision || shot.travelled >= range - 0.000001) {
        hit = true;
        const body = collision?.collider.parent(),
          target = [...race.cars.values()].find((c) => c.body.handle === body?.handle);
        finishProjectile(race, shot, target);
      }
    }
    if (hit) race.removeShot(shot);
    else keep.push(shot);
  }
  race.shots = keep;
}
