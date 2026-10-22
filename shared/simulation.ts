import { movingHazardPose } from './biome-layout.ts';
import * as weapons from './weapons.ts';
import type { Car, Driver, Shot } from './entities.ts';
import { bodyYaw, clamp, v3 } from './physics-utils.ts';
import { isInput } from './protocol.ts';
import {
  PHYSICS_STEP_SECONDS as DT,
  CAR_MASS as MASS,
  VEHICLE_RIDE_HEIGHT,
  MAX_PLAYERS,
  STARTING_SCORE,
  COUNTDOWN_TICKS,
  SUMMARY_DELAY_TICKS,
  ROUND_SUMMARY_TICKS,
  FINAL_RESULTS_TICKS,
  STALE_INPUT_TICKS,
  DISCONNECTED_PLAYER_TICKS,
  PHYSICS_HZ,
  PICKUP_RADIUS,
  PICKUP_RESPAWN_TICKS,
  RACE_TIMEOUT_REFERENCE_METRES,
} from './rules.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion } from 'three';
import {
  COLORS,
  type CarState,
  type GameEvent,
  type Phase,
  type Result,
  type Snapshot,
  type Vec,
  type Weapon,
} from './types.ts';
import { getTrack, type Track } from './track.ts';
import { DEFAULT_SETTINGS, type RaceSettings } from './maps.ts';
import { drivingControl } from './driving.ts';
import { VehiclePhysics } from './vehicle.ts';
import { CATCH_UP, updateCatchUp } from './catch-up.ts';
const WEAPON_LIST: Weapon[] = ['boost', 'rocket', 'mine', 'frost', 'pulse'];
const PICKUP_SHAPE = new RAPIER.Ball(PICKUP_RADIUS);
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
let initPromise: Promise<void> | undefined;
export const initPhysics = () => (initPromise ??= RAPIER.init());

export class Race {
  world: RAPIER.World;
  cars = new Map<string, Car>();
  private readonly carBodies = new Set<number>();
  shots: Shot[] = [];
  obstacleBodies = new Map<number, RAPIER.RigidBody>();
  movingHazards = new Map<number, RAPIER.RigidBody>();
  hazardTick = 0;
  pickupUntil: number[];
  track: Track;
  adminId: string | null = null;
  phase: Phase = 'lobby';
  tick = 0;
  phaseUntil = 0;
  summaryAt = 0;
  roundStart = 0;
  round = 0;
  cameraProgress = 0;
  results: Result[] = [];
  events: GameEvent[] = [];
  message = 'Wskakuj do gry';
  seed: number;
  nextEntity = 1;
  nextEvent = 1;
  raceStart = 0;
  deaths: string[][] = [];
  private finishOrder: string[] = [];
  pendingDeaths = new Map<string, string>();
  previousPhase: Phase = 'racing';
  lastCollision = new Map<string, number>();
  constructor(
    seed = 12345,
    public settings: RaceSettings = { ...DEFAULT_SETTINGS },
  ) {
    this.settings = { ...settings };
    this.track = getTrack(settings.mapId);
    this.pickupUntil = Array(72).fill(0);
    this.seed = seed;
    this.world = new RAPIER.World({ x: 0, y: -30, z: 0 });
    this.world.timestep = DT;
    const road = this.track.roadGeometry(this.track.ROAD_WIDTH + 0.65);
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(
        road.vertices,
        road.indices,
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      )
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
    );
    const terrain = this.track.terrainGeometry();
    if (terrain)
      this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          terrain.vertices,
          terrain.indices,
          RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
        )
          .setFriction(0)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
      );
    if (this.track.desert) {
      for (const object of this.track.desert.objects.filter((object) => object.solid))
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(object.size.x / 2, object.size.y / 2, object.size.z / 2)
            .setTranslation(
              object.position.x,
              object.position.y + object.size.y / 2,
              object.position.z,
            )
            .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), object.yaw))
            .setFriction(0.25)
            .setRestitution(0.25),
        );
      const fountain = this.track.desert.fountain;
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.7, 3)
          .setTranslation(fountain.x, 0.7, fountain.z)
          .setRestitution(0.2),
      );
    }
    for (const prop of this.track.biome?.props ?? [])
      if (prop.solid)
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(prop.size.x / 2, prop.size.y / 2, prop.size.z / 2)
            .setTranslation(prop.position.x, prop.position.y + prop.size.y / 2, prop.position.z)
            .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), prop.yaw))
            .setRestitution(0.15)
            .setFriction(0.3),
        );
    for (const fixture of this.track.biome?.fixtures ?? [])
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(fixture.size.x / 2, fixture.size.y / 2, fixture.size.z / 2)
          .setTranslation(fixture.position.x, fixture.position.y, fixture.position.z)
          .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), fixture.yaw))
          .setRestitution(0.15)
          .setFriction(0.3),
      );
    for (const hazard of this.track.biome?.hazards ?? []) {
      const pose = movingHazardPose(hazard, 0);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(pose.position.x, pose.position.y, pose.position.z)
          .setRotation(pose.rotation),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hazard.size.x / 2, hazard.size.y / 2, hazard.size.z / 2)
          .setFriction(0.3)
          .setRestitution(0.1),
        body,
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(
          hazard.kind === 'timber' ? 0.85 : 0.7,
          hazard.kind === 'timber' ? 0.8 : 0.85,
        ).setFriction(0.3),
        body,
      );
      this.movingHazards.set(hazard.id, body);
    }
    for (const ramp of this.track.RAMPS) {
      const geometry = this.track.rampGeometry(ramp);
      this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          geometry.vertices,
          geometry.indices,
          RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
        )
          .setFriction(0)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
      );
    }
    for (const o of this.track.OBSTACLES) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), o.yaw);
      const collider =
        o.kind === 'log'
          ? RAPIER.ColliderDesc.cylinder(o.size.x / 2, o.size.y / 2).setRotation(
              new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
            )
          : o.kind === 'barrel'
            ? RAPIER.ColliderDesc.cylinder(o.size.y / 2, o.size.x / 2)
            : RAPIER.ColliderDesc.cuboid(o.size.x / 2, o.size.y / 2, o.size.z / 2);
      collider
        .setRestitution(0.2)
        .setFriction(0.65)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
      if (o.dynamic) {
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(o.position.x, o.position.y + 0.03, o.position.z)
            .setRotation(q)
            .setLinearDamping(0.9)
            .setAngularDamping(1.2)
            .setCcdEnabled(true),
        );
        this.world.createCollider(collider.setMass(o.mass), body);
        this.obstacleBodies.set(o.id, body);
      } else
        this.world.createCollider(
          collider.setTranslation(o.position.x, o.position.y, o.position.z).setRotation(q),
        );
    }
    // Guardrails leave deliberately open sections for knock-outs.
    for (let s = 0; s < this.track.TRACK_LENGTH; s += 5) {
      if (!this.track.hasGuardrail(s)) continue;
      const start = this.track.trackAt(s - 2.5),
        end = this.track.trackAt(s + 2.5);
      for (const side of [-1, 1]) {
        const from = start.p.clone().addScaledVector(start.n, (start.width + 0.45) * side);
        const to = end.p.clone().addScaledVector(end.n, (end.width + 0.45) * side);
        const delta = to.clone().sub(from),
          p = from.clone().add(to).multiplyScalar(0.5);
        const q = new Quaternion().setFromAxisAngle(
          new Vector3(0, 1, 0),
          Math.atan2(delta.x, delta.z),
        );
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.22, 0.65, delta.length() / 2 + 0.06)
            .setTranslation(p.x, 0.5, p.z)
            .setRotation(q)
            .setRestitution(0.3)
            .setFriction(0.08),
        );
      }
    }
  }
  get maximumRaceTicks() {
    return Math.ceil(
      9000 *
        Math.max(1, this.settings.lapLimit / 3) *
        Math.max(1, this.track.TRACK_LENGTH / RACE_TIMEOUT_REFERENCE_METRES),
    );
  }
  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  addDriver(d: Driver) {
    if (this.cars.size >= MAX_PLAYERS) throw new Error('Pokój jest pełny.');
    const a = this.track.trackAt(-4 - Math.floor(d.slot / 4) * 5),
      p = a.p.clone().addScaledVector(a.n, ((d.slot % 4) - 1.5) * 2.7);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, VEHICLE_RIDE_HEIGHT, p.z)
        .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw))
        .setLinearDamping(0.1)
        .setAngularDamping(1.6)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.79, 0.52, 1.52)
        .setMassProperties(
          MASS,
          { x: 0, y: -0.25, z: 0 },
          { x: 260, y: 220, z: 180 },
          IDENTITY_ROTATION,
        )
        .setFriction(0.12)
        .setRestitution(0.08),
      body,
    );
    this.carBodies.add(body.handle);
    const car: Car = {
      ...d,
      body,
      vehicle: new VehiclePhysics(this.world, body, this.carBodies),
      score: STARTING_SCORE,
      alive: true,
      progress: 0,
      weapon: null,
      boostUntil: 0,
      frostUntil: 0,
      invulnerableUntil: 0,
      outsideTicks: 0,
      lastInputTick: -999,
      input: { seq: -1, left: false, right: false, actionSeq: 0 },
      usedAction: 0,
      hitUntil: 0,
      wreckUntil: 0,
      steering: 0,
      drift: 0,
      grounded: false,
      reverseHold: 0,
      reversing: false,
      catchUp: 0,
    };
    this.cars.set(d.id, car);
    return car;
  }
  removeDriver(id: string) {
    const c = this.cars.get(id);
    if (c) {
      c.vehicle.dispose();
      this.carBodies.delete(c.body.handle);
      this.world.removeRigidBody(c.body);
      this.cars.delete(id);
      this.pendingDeaths.delete(id);
      this.finishOrder = this.finishOrder.filter((driver) => driver !== id);
      this.deaths = this.deaths
        .map((group) => group.filter((driver) => driver !== id))
        .filter((group) => group.length);
      this.lastCollision.delete(id);
    }
  }
  setConnected(id: string, connected: boolean) {
    const c = this.cars.get(id);
    if (c) {
      c.connected = connected;
      if (!connected) {
        c.input = { ...c.input, left: false, right: false };
        c.catchUp = 0;
        c.reverseHold = 0;
        c.reversing = false;
      }
    }
  }
  input(id: string, input: unknown) {
    const c = this.cars.get(id);
    if (!c || !isInput(input) || input.seq <= c.input.seq || input.actionSeq < c.input.actionSeq)
      return false;
    c.input = { ...input };
    c.lastInputTick = this.tick;
    return true;
  }
  resetInput(id: string) {
    const c = this.cars.get(id);
    if (c) {
      c.input = { seq: -1, left: false, right: false, actionSeq: 0 };
      c.usedAction = 0;
      c.reverseHold = 0;
      c.reversing = false;
      c.lastInputTick = -999;
    }
  }
  emit(
    type: GameEvent['type'],
    position: Vec,
    text?: string,
    color?: string,
    weapon?: Weapon,
    strength?: number,
  ) {
    this.events.push({
      id: this.nextEvent++,
      tick: this.tick,
      type,
      position: { ...position },
      text,
      color,
      weapon,
      strength,
    });
    if (this.events.length > 80) this.events.shift();
  }
  start() {
    if (this.cars.size < 2)
      throw new Error('Potrzeba co najmniej 2 graczy. Dodaj znajomego lub bota.');
    if ([...this.cars.values()].some((c) => !c.bot && (!c.connected || !c.ready)))
      throw new Error('Poczekaj, aż gracze będą gotowi.');
    this.results = [];
    this.summaryAt = 0;
    this.round = 1;
    this.raceStart = this.tick + COUNTDOWN_TICKS;
    this.cameraProgress = 0;
    this.deaths = [];
    this.pendingDeaths.clear();
    this.clearShots();
    this.resetObstacles();
    this.pickupUntil.fill(0);
    for (const c of this.cars.values()) {
      c.score = STARTING_SCORE;
      c.progress = 0;
      this.place(c, 0);
    }
    this.phase = 'countdown';
    this.phaseUntil = this.tick + COUNTDOWN_TICKS;
    this.message = 'Silniki gotowe';
  }
  place(c: Car, s: number) {
    this.finishOrder = this.finishOrder.filter((id) => id !== c.id);
    const offset = Math.floor(c.slot / 4) * 5 + 5,
      a = this.track.trackAt(s - offset),
      p = a.p.clone().addScaledVector(a.n, ((c.slot % 4) - 1.5) * 2.7);
    c.body.setEnabled(true);
    c.body.setEnabledRotations(true, true, true, true);
    c.body.setTranslation({ x: p.x, y: VEHICLE_RIDE_HEIGHT, z: p.z }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    c.wreckUntil = 0;
    c.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw), true);
    c.body.resetForces(true);
    c.progress = s - offset;
    c.alive = true;
    c.weapon = null;
    c.outsideTicks = 0;
    c.boostUntil = 0;
    c.frostUntil = 0;
    c.invulnerableUntil = this.tick + 65;
    c.hitUntil = 0;
    c.usedAction = c.input.actionSeq;
    c.steering = 0;
    c.drift = 0;
    c.grounded = false;
    c.reverseHold = 0;
    c.reversing = false;
    c.catchUp = 0;
    c.vehicle.reset();
  }
  pause() {
    if (this.phase !== 'paused' && this.phase !== 'lobby' && this.phase !== 'finished') {
      this.previousPhase = this.phase;
      this.phase = 'paused';
    }
  }
  resume() {
    if (this.phase === 'paused') this.phase = this.previousPhase;
  }
  lobby() {
    this.phase = 'lobby';
    this.results = [];
    this.summaryAt = 0;
    this.clearShots();
    this.resetObstacles();
    this.pendingDeaths.clear();
    for (const c of this.cars.values()) {
      this.place(c, 0);
    }
    this.cameraProgress = 0;
  }
  removeShot(shot: Shot) {
    if (shot.body) {
      this.world.removeRigidBody(shot.body);
      shot.body = undefined;
    }
  }
  clearShots() {
    for (const shot of this.shots) this.removeShot(shot);
    this.shots = [];
  }
  resetObstacles() {
    this.hazardTick = 0;
    for (const hazard of this.track.biome?.hazards ?? []) {
      const body = this.movingHazards.get(hazard.id)!;
      const pose = movingHazardPose(hazard, 0);
      body.setTranslation(pose.position, true);
      body.setRotation(pose.rotation, true);
      body.setNextKinematicTranslation(pose.position);
      body.setNextKinematicRotation(pose.rotation);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    for (const o of this.track.OBSTACLES) {
      const body = this.obstacleBodies.get(o.id);
      if (!body) continue;
      body.setEnabled(true);
      body.setTranslation({ x: o.position.x, y: o.position.y + 0.03, z: o.position.z }, true);
      body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), o.yaw), true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.resetForces(true);
      body.resetTorques(true);
    }
  }
  gridProgress(origin: number) {
    for (let shift = 0; shift <= 48; shift += 2) {
      let clear = true;
      for (const c of this.cars.values()) {
        const s = origin + shift - Math.floor(c.slot / 4) * 5 - 5,
          side = ((c.slot % 4) - 1.5) * 2.7,
          a = this.track.trackAt(s),
          p = a.p.addScaledVector(a.n, side);
        if (this.track.isGap(s, 8)) clear = false;
        if (
          this.track.biome?.hazards.some(
            (h) =>
              Math.abs(
                ((s - h.s + this.track.TRACK_LENGTH * 1.5) % this.track.TRACK_LENGTH) -
                  this.track.TRACK_LENGTH / 2,
              ) < 10,
          )
        )
          clear = false;
        const spawn = { x: p.x, y: 0.75, z: p.z },
          rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw),
          shape = c.body.collider(0).shape;
        if (
          this.world.intersectionWithShape(
            spawn,
            rotation,
            shape,
            RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          )
        )
          clear = false;
        if (
          this.track.PICKUP_SPAWNS.some(
            (pickup) =>
              v3(spawn).distanceToSquared(pickup.position) < 9 &&
              shape.intersectsShape(
                spawn,
                rotation,
                PICKUP_SHAPE,
                pickup.position,
                IDENTITY_ROTATION,
              ),
          )
        )
          clear = false;
        for (const o of this.track.OBSTACLES) {
          const dx = p.x - o.position.x,
            dz = p.z - o.position.z,
            x = dx * Math.cos(o.yaw) - dz * Math.sin(o.yaw),
            z = dx * Math.sin(o.yaw) + dz * Math.cos(o.yaw);
          if (Math.abs(x) < o.size.x / 2 + 1.1 && Math.abs(z) < o.size.z / 2 + 2) clear = false;
        }
        for (const ramp of this.track.RAMPS) {
          let delta =
            (((s - ramp.s) % this.track.TRACK_LENGTH) + this.track.TRACK_LENGTH) %
            this.track.TRACK_LENGTH;
          if (delta > this.track.TRACK_LENGTH / 2) delta -= this.track.TRACK_LENGTH;
          if (
            Math.abs(delta) < ramp.length / 2 + 2 &&
            Math.abs(side - ramp.side) < ramp.width / 2 + 1.1
          )
            clear = false;
        }
      }
      if (clear) return origin + shift;
    }
    return origin + 48;
  }
  freezeSurvivors() {
    for (const c of this.cars.values())
      if (c.alive) {
        c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        c.body.resetForces(true);
        c.body.setEnabled(false);
      }
  }
  settleBodies() {
    for (const c of this.cars.values())
      if (!c.alive && c.wreckUntil && this.tick >= c.wreckUntil) {
        c.body.setEnabled(false);
        c.wreckUntil = 0;
      }
    for (const body of this.obstacleBodies.values())
      if (body.isEnabled() && body.translation().y < -10) body.setEnabled(false);
    for (const shot of this.shots)
      if (shot.body) {
        shot.position = { ...shot.body.translation() };
        shot.rotation = { ...shot.body.rotation() };
      }
  }
  eliminate(id: string, reason: string) {
    const c = this.cars.get(id);
    if (c?.alive && !this.finishOrder.includes(id) && !this.pendingDeaths.has(id))
      this.pendingDeaths.set(id, reason);
  }
  useWeapon(c: Car): void {
    if (!this.finishOrder.includes(c.id)) weapons.useWeapon(this, c);
  }
  step() {
    if (this.phase === 'paused') return;
    this.tick++;
    this.settleBodies();
    if (this.phase === 'lobby') return;
    if (this.phase === 'finished') {
      this.world.step();
      this.settleBodies();
      return;
    }
    if (this.phase === 'countdown') {
      if (this.tick >= this.phaseUntil) {
        this.phase = 'racing';
        this.roundStart = this.tick;
        for (const c of this.cars.values()) c.invulnerableUntil = this.tick + 50;
        this.message = 'Gaz. Chaos. Rewanż.';
      }
      return;
    }
    if (this.phase === 'segment') {
      this.world.step();
      this.settleBodies();
      if (this.tick >= this.phaseUntil) {
        this.clearShots();
        this.resetObstacles();
        const s = this.gridProgress(this.cameraProgress + 5);
        for (const c of this.cars.values()) {
          this.place(c, s);
        }
        this.cameraProgress = s - 5;
        this.deaths = [];
        this.round++;
        this.roundStart = this.tick;
        this.phase = 'racing';
        this.message = 'Kolejna runda!';
      }
      return;
    }
    this.hazardTick++;
    for (const hazard of this.track.biome?.hazards ?? []) {
      const body = this.movingHazards.get(hazard.id)!;
      const pose = movingHazardPose(hazard, this.hazardTick);
      body.setNextKinematicTranslation(pose.position);
      body.setNextKinematicRotation(pose.rotation);
    }
    const leaderProgress = Math.max(
      ...[...this.cars.values()]
        .filter((car) => car.alive && !this.finishOrder.includes(car.id))
        .map((car) => car.progress),
    );
    for (const c of this.cars.values()) {
      if (!c.alive || this.finishOrder.includes(c.id)) continue;
      const pos = c.body.translation(),
        a = this.track.trackAt(c.progress);
      let left = false,
        right = false,
        fire = false;
      if (c.bot) {
        fire =
          !!c.weapon &&
          (c.weapon === 'boost' ||
            [...this.cars.values()].some(
              (o) => o.id !== c.id && o.alive && v3(o.body.translation()).distanceTo(v3(pos)) < 20,
            ));
      } else if (this.tick - c.lastInputTick <= STALE_INPUT_TICKS && c.connected) {
        left = c.input.left;
        right = c.input.right;
        fire = c.input.actionSeq > c.usedAction;
      }
      c.usedAction = c.input.actionSeq;
      if (fire) this.useWeapon(c);
      if (!c.connected && !c.bot && this.tick - c.lastInputTick > DISCONNECTED_PLAYER_TICKS) {
        this.eliminate(c.id, 'utrata połączenia');
        continue;
      }
      const brake = left && right,
        vel = c.body.linvel(),
        yaw = bodyYaw(c.body);
      const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const speedForward = vel.x * forward.x + vel.z * forward.z;
      let turn = Number(left) - Number(right);
      if (c.bot) {
        const target = this.track.trackAt(c.progress + Math.max(6, Math.abs(speedForward) * 0.4));
        const destination = target.p
          .clone()
          .addScaledVector(target.n, this.track.botLane(c.progress, c.slot));
        const wantedYaw = Math.atan2(destination.x - pos.x, destination.z - pos.z);
        turn = clamp(Math.atan2(Math.sin(wantedYaw - yaw), Math.cos(wantedYaw - yaw)) * 2.5, -1, 1);
      }
      const frozen = c.frostUntil > this.tick,
        boost = c.boostUntil > this.tick,
        hit = c.hitUntil > this.tick;
      const eligible =
        (c.connected || c.bot) && forward.dot(a.t) > 0.5 && !brake && !boost && !frozen && !hit;
      if (!eligible) c.catchUp = 0;
      const drive = drivingControl(
        speedForward,
        c,
        { speed: Math.hypot(vel.x, vel.z), turn, brake, boost, frozen, hit },
        DT,
        c.catchUp,
      );
      c.reverseHold = drive.reverseHold;
      c.reversing = drive.reversing;
      c.steering = drive.steering;
      c.drift = c.bot ? 0 : drive.drift;
      c.body.resetForces(true);
      c.vehicle.update({ ...drive, drift: c.drift, frozen, hit });
      c.grounded = c.vehicle.contacts > 0;
      c.catchUp = updateCatchUp(c.catchUp, leaderProgress - c.progress, eligible && c.grounded, DT);
    }
    const beforeStep = new Map(
      [...this.cars.values()].filter((c) => c.alive).map((c) => [c.id, c.body.linvel()]),
    );
    this.world.step();
    this.settleBodies();
    const finishLine = this.track.TRACK_LENGTH * this.settings.lapLimit;
    const crossings: { car: Car; fraction: number }[] = [];
    for (const c of this.cars.values())
      if (c.alive && !this.finishOrder.includes(c.id)) {
        const p = c.body.translation(),
          previousProgress = c.progress,
          pr = this.track.projectOnTrack(p, c.progress);
        const before = beforeStep.get(c.id)!,
          velocity = c.body.linvel(),
          impact = Math.hypot(velocity.x - before.x, velocity.z - before.z);
        if (impact > 3 && (this.lastCollision.get(c.id) ?? -100) < this.tick - 10) {
          this.lastCollision.set(c.id, this.tick);
          this.emit('collision', p, undefined, '#ffd27b', undefined, clamp(impact / 10, 0.25, 1));
        }
        if (Math.abs(pr.delta) < 3.5 && pr.distance < this.track.trackAt(pr.s).width + 12)
          c.progress += pr.delta;
        if (c.progress >= finishLine)
          crossings.push({
            car: c,
            fraction:
              previousProgress >= finishLine
                ? 0
                : clamp((finishLine - previousProgress) / (c.progress - previousProgress), 0, 1),
          });
        if (
          p.y < -0.9 &&
          this.track.isGap(pr.s) &&
          Math.abs(pr.lateral) < this.track.ROAD_WIDTH + 2
        ) {
          if (this.settings.mapId === 'volcano') {
            c.wreckUntil = this.tick + 70;
            c.body.setEnabledRotations(true, true, true, true);
            this.emit('explosion', p, 'LAWA', '#ff722d', undefined, 0.65);
          }
          this.eliminate(c.id, this.settings.mapId === 'volcano' ? 'lawa' : 'rzeka');
        }
        if (p.y < -3) this.eliminate(c.id, 'wypadnięcie z toru');
        if (c.invulnerableUntil <= this.tick && this.track.outsideCamera(p, this.cameraProgress))
          c.outsideTicks++;
        else c.outsideTicks = 0;
        if (c.outsideTicks > 25) this.eliminate(c.id, 'poza kadrem');
        if (!c.weapon && !this.pendingDeaths.has(c.id))
          for (const pickup of this.track.PICKUP_SPAWNS)
            if (
              this.pickupUntil[pickup.id] <= this.tick &&
              v3(p).distanceToSquared(pickup.position) < 9 &&
              c.body.collider(0).intersectsShape(PICKUP_SHAPE, pickup.position, IDENTITY_ROTATION)
            ) {
              c.weapon = WEAPON_LIST[Math.floor(this.random() * WEAPON_LIST.length)];
              this.pickupUntil[pickup.id] = this.tick + PICKUP_RESPAWN_TICKS;
              this.emit('pickup', pickup.position, undefined, COLORS[c.slot], c.weapon);
              break;
            }
      }
    this.updateShots();
    weapons.updateNitroExhaust(this);
    if (this.pendingDeaths.size) {
      const group: string[] = [];
      for (const [id, reason] of this.pendingDeaths) {
        const c = this.cars.get(id);
        if (c?.alive) {
          c.alive = false;
          c.catchUp = 0;
          c.reverseHold = 0;
          c.reversing = false;
          c.body.resetForces(true);
          if (c.wreckUntil <= this.tick) c.body.setEnabled(false);
          group.push(id);
          this.emit('elimination', c.body.translation(), `${c.name} · ${reason}`, COLORS[c.slot]);
        }
      }
      if (group.length) this.deaths.push(group);
      this.pendingDeaths.clear();
    }
    const alive = [...this.cars.values()].filter((c) => c.alive);
    const duel = alive.length === 2;
    if (duel || this.finishOrder.length) {
      // Resolve same-tick crossings by the fraction of the physics step to the line.
      for (const { car } of crossings.sort(
        (a, b) => a.fraction - b.fraction || a.car.slot - b.car.slot,
      )) {
        if (!car.alive) continue;
        this.finishOrder.push(car.id);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        car.body.resetForces(true);
        car.body.setEnabled(false);
        car.weapon = null;
        car.boostUntil = car.frostUntil = car.hitUntil = 0;
        car.catchUp = car.reverseHold = car.steering = car.drift = 0;
        car.reversing = false;
        car.invulnerableUntil = Infinity;
      }
    }
    const unfinished = alive.filter((c) => !this.finishOrder.includes(c.id));
    const leader = Math.max(...unfinished.map((c) => c.progress), this.cameraProgress - 15);
    this.cameraProgress += (leader - 4 - this.cameraProgress) * 0.08;
    const lapFinish = this.finishOrder.length
      ? unfinished.length === 0 || alive.length <= 1
      : !duel && alive.some((c) => c.progress >= finishLine);
    // The last two race to the line without either time limit interrupting them.
    const timedOut =
      !duel &&
      (this.tick - this.roundStart >= 1000 || this.tick - this.raceStart >= this.maximumRaceTicks);
    if (alive.length <= 1 || timedOut || lapFinish)
      this.endSegment(lapFinish || (!duel && this.tick - this.raceStart >= this.maximumRaceTicks));
  }
  blastBlocked(origin: Vector3, target: Vector3): boolean {
    return weapons.blastBlocked(this, origin, target);
  }
  blast(position: Vec, kind: 'mine' | 'rocket', protectedCarId?: string): void {
    weapons.blast(this, position, kind, protectedCarId);
  }
  updateShots(): void {
    weapons.updateShots(this);
  }
  endSegment(forceFinish = false) {
    const alive = [...this.cars.values()]
      .filter((c) => c.alive)
      .sort((a, b) => b.progress - a.progress);
    const groups = [
      ...this.finishOrder.map((id) => [id]),
      ...alive.filter((c) => !this.finishOrder.includes(c.id)).map((c) => [c.id]),
      ...this.deaths.slice().reverse(),
    ];
    const n = this.cars.size,
      table =
        n === 2
          ? [1, -1]
          : n === 3
            ? [1, 0, -1]
            : [2, 1, ...Array(Math.max(0, n - 4)).fill(0), -1, -2];
    let rank = 0;
    const changes: string[] = [];
    if (alive.length || this.deaths.length > 1)
      for (const group of groups) {
        const delta = table[Math.min(n - 1, rank + group.length - 1)] ?? 0;
        for (const id of group) {
          const c = this.cars.get(id)!;
          const finishIndex = this.finishOrder.indexOf(id);
          const awarded = finishIndex >= 0 ? 2 - finishIndex : delta;
          c.score = clamp(c.score + awarded, 0, this.settings.winningScore);
          changes.push(`${c.name} ${awarded > 0 ? '+' : ''}${awarded}`);
        }
        rank += group.length;
      }
    this.message = changes.join('  ·  ') || 'Remis!';
    this.emit('round', this.track.trackAt(this.cameraProgress).p, this.message);
    if (forceFinish || [...this.cars.values()].some((c) => c.score >= this.settings.winningScore)) {
      this.finish();
      return;
    }
    this.freezeSurvivors();
    this.phase = 'segment';
    this.summaryAt = this.tick + SUMMARY_DELAY_TICKS;
    this.phaseUntil = this.summaryAt + ROUND_SUMMARY_TICKS;
  }
  finish() {
    const sorted = [...this.cars.values()].sort(
      (a, b) => b.score - a.score || b.progress - a.progress,
    );
    this.results = sorted.map((c, i) => ({
      id: c.id,
      name: c.name,
      color: COLORS[c.slot],
      score: c.score,
      place: i + 1,
      cupPoints: sorted.length - i - 1,
    }));
    if (sorted[0]) sorted[0].wins++;
    this.freezeSurvivors();
    this.phase = 'finished';
    this.summaryAt = this.tick + SUMMARY_DELAY_TICKS;
    this.phaseUntil = this.summaryAt + FINAL_RESULTS_TICKS;
    this.message = `${sorted[0]?.name ?? 'Gracz'} wygrywa!`;
    this.emit('finish', this.track.trackAt(this.cameraProgress).p, this.message);
  }
  snapshot(code: string): Snapshot {
    const cars: CarState[] = [...this.cars.values()].map((c) => {
      const p = c.body.translation(),
        v = c.body.linvel(),
        q = c.body.rotation();
      return {
        id: c.id,
        name: c.name,
        color: COLORS[c.slot],
        slot: c.slot,
        bot: c.bot,
        connected: c.connected,
        ready: c.ready,
        alive: c.alive,
        finishPlace: this.finishOrder.indexOf(c.id) + 1,
        score: c.score,
        wins: c.wins,
        weapon: c.weapon,
        progress: c.progress,
        position: { x: p.x, y: p.y, z: p.z },
        rotation: { ...q },
        wrecked: !c.alive && c.wreckUntil > this.tick,
        yaw: Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)),
        speed: Math.hypot(v.x, v.z),
        steering: c.steering,
        drift: c.drift,
        grounded: c.grounded,
        suspension: [...c.vehicle.suspension],
        slip: Math.atan2(
          v.x * Math.cos(bodyYaw(c.body)) - v.z * Math.sin(bodyYaw(c.body)),
          Math.max(0.1, v.x * Math.sin(bodyYaw(c.body)) + v.z * Math.cos(bodyYaw(c.body))),
        ),
        frozen: c.frostUntil > this.tick,
        boosted: c.boostUntil > this.tick,
        catchUpBonus: this.phase === 'racing' ? c.catchUp * CATCH_UP.maxSpeedBonus : 0,
        invulnerable: c.invulnerableUntil > this.tick,
      };
    });
    const obstacles = [...this.obstacleBodies, ...this.movingHazards].map(([id, body]) => ({
      id,
      position: { ...body.translation() },
      rotation: { ...body.rotation() },
    }));
    return {
      code,
      settings: { ...this.settings },
      adminId: this.adminId,
      phase: this.phase,
      tick: this.tick,
      seconds: Math.max(0, (this.phaseUntil - this.tick) / PHYSICS_HZ),
      summaryAt: this.summaryAt,
      lap: clamp(
        Math.floor(Math.max(0, ...cars.map((c) => c.progress)) / this.track.TRACK_LENGTH) + 1,
        1,
        this.settings.lapLimit,
      ),
      lapLimit: this.settings.lapLimit,
      cameraProgress: this.cameraProgress,
      cars,
      obstacles,
      projectiles: this.shots.map(({ born, expires, velocity, travelled, body, ...shot }) => shot),
      pickups: this.track.PICKUP_SPAWNS.map((p) => ({
        id: p.id,
        position: p.position,
        active: this.pickupUntil[p.id] <= this.tick,
      })),
      events: this.events.filter((e) => this.tick - e.tick < 180),
      results: this.results,
      round: this.round,
      message: this.message,
      canStart: cars.length >= 2 && cars.every((c) => c.bot || (c.connected && c.ready)),
    };
  }
  dispose() {
    for (const c of this.cars.values()) c.vehicle.dispose();
    this.world.free();
  }
}
