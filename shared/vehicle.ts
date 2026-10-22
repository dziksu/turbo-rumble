import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { CAR_MASS, PHYSICS_STEP_SECONDS as DT } from './rules.ts';
import { clamp } from './physics-utils.ts';

export const SUSPENSION = Object.freeze({
  restLength: 0.4,
  radius: 0.32,
  anchorY: -0.12,
  stiffness: 50,
  compression: 4.6,
  relaxation: 6.5,
  staticCompression: 0.15,
  maxTravel: 0.22,
});

export interface VehicleControl {
  steering: number;
  acceleration: number;
  yawRate: number;
  drift: number;
  brake: boolean;
  hit: boolean;
  frozen: boolean;
}

/** Four raycast tyres. Native Rapier impulses own traction, suspension and chassis motion. */
export class VehiclePhysics {
  controller: RAPIER.DynamicRayCastVehicleController;
  readonly suspension = [0, 0, 0, 0];
  contacts = 0;
  private readonly up = new Vector3();
  private readonly normal = new Vector3();
  private readonly correction = new Vector3();
  private readonly rotation = new Quaternion();

  constructor(
    private readonly world: RAPIER.World,
    readonly body: RAPIER.RigidBody,
    private readonly carBodies: Set<number>,
  ) {
    this.controller = this.createController();
  }

  private createController() {
    const controller = this.world.createVehicleController(this.body);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2;
    // Wire order: front left, front right, rear left, rear right. +Z is the nose.
    for (const z of [1.1, -1.1])
      for (const x of [0.78, -0.78]) {
        controller.addWheel(
          { x, y: SUSPENSION.anchorY, z },
          { x: 0, y: -1, z: 0 },
          { x: -1, y: 0, z: 0 },
          SUSPENSION.restLength,
          SUSPENSION.radius,
        );
        const i = controller.numWheels() - 1;
        controller.setWheelSuspensionStiffness(i, SUSPENSION.stiffness);
        controller.setWheelSuspensionCompression(i, SUSPENSION.compression);
        controller.setWheelSuspensionRelaxation(i, SUSPENSION.relaxation);
        controller.setWheelMaxSuspensionTravel(i, SUSPENSION.maxTravel);
        controller.setWheelMaxSuspensionForce(i, CAR_MASS * 60);
      }
    return controller;
  }

  reset() {
    this.world.removeVehicleController(this.controller);
    this.controller = this.createController();
    this.contacts = 0;
    this.suspension.fill(0);
  }

  update(control: VehicleControl) {
    const { controller } = this;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      controller.setWheelSteering(i, front ? control.steering * 0.52 : 0);
      controller.setWheelEngineForce(
        i,
        control.brake || control.hit ? 0 : (CAR_MASS * control.acceleration) / 4,
      );
      controller.setWheelBrake(i, control.brake ? (CAR_MASS * 22 * DT) / 4 : 0);
      controller.setWheelFrictionSlip(
        i,
        control.hit ? 0.35 : control.frozen ? 1.2 : front ? 1.4 : 2.8 - control.drift * 2.25,
      );
      controller.setWheelSideFrictionStiffness(
        i,
        control.hit ? 0.1 : front ? 0.4 : 0.75 - control.drift * 0.65,
      );
    }
    controller.updateVehicle(DT, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (collider) => {
      const parent = collider.parent();
      // Other cars remain chassis collisions; a roof must never act as wheel ground.
      return !parent || !this.carBodies.has(parent.handle);
    });
    this.contacts = 0;
    this.normal.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const normal = controller.wheelContactNormal(i);
      if (controller.wheelIsInContact(i) && normal && normal.y > 0.35) {
        this.contacts++;
        this.normal.add(normal);
      }
      this.suspension[i] = clamp(
        SUSPENSION.restLength -
          (controller.wheelSuspensionLength(i) ?? SUSPENSION.restLength) -
          SUSPENSION.staticCompression,
        -SUSPENSION.maxTravel,
        SUSPENSION.restLength - SUSPENSION.staticCompression,
      );
    }
    if (control.hit) return;
    // A bounded stabilizer keeps arcade landings recoverable without locking pitch/roll
    // or overwriting the angular momentum from a collision. Wrecks never run this update.
    this.rotation.copy(this.body.rotation());
    this.up.set(0, 1, 0).applyQuaternion(this.rotation);
    if (this.contacts >= 2) this.normal.normalize();
    else this.normal.set(0, 1, 0);
    this.correction.crossVectors(this.up, this.normal);
    const angular = this.body.angvel();
    const grounded = this.contacts > 0;
    const spring = grounded ? 30 : 4;
    const damping = grounded ? 9 : 1.4;
    this.body.applyTorqueImpulse(
      {
        x: clamp((this.correction.x * spring - angular.x * damping) * 260 * DT, -500, 500),
        y: grounded ? clamp((control.yawRate - angular.y) * 220 * 18 * DT, -600, 600) : 0,
        z: clamp((this.correction.z * spring - angular.z * damping) * 180 * DT, -500, 500),
      },
      true,
    );
  }

  dispose() {
    this.world.removeVehicleController(this.controller);
  }
}
