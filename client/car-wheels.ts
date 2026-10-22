import { Box3, Object3D, Quaternion, Vector3, type QuaternionLike, type Vector3Like } from 'three';

interface WheelPose {
  position: Vector3Like;
  rotation: QuaternionLike;
  steering: number;
  moving: boolean;
  grounded: boolean;
  suspension?: number[];
}

/** Kenney cars face +Z; only the four road wheels roll around their local +X axle. */
export class CarWheels {
  readonly all: Object3D[] = [];
  readonly road: {
    node: Object3D;
    base: Quaternion;
    front: boolean;
    radius: number;
    spin: number;
    index: number;
    baseY: number;
    scaleY: number;
    travel: number;
  }[] = [];
  private readonly previousPosition = new Vector3();
  private readonly previousRotation = new Quaternion();
  private readonly rotation = new Quaternion();
  private readonly delta = new Vector3();
  private readonly forward = new Vector3();
  private readonly heading = new Quaternion();
  private readonly turn = new Quaternion();
  private readonly roll = new Quaternion();
  private readonly axle = new Vector3(1, 0, 0);
  private readonly up = new Vector3(0, 1, 0);
  private sampled = false;
  private rollingSpeed = 0;

  /** Bind the scaled, upright clone before applying its race/stunt pose. Owns no GPU resources. */
  constructor(vehicle: Object3D) {
    vehicle.updateWorldMatrix(true, true);
    vehicle.traverse((node) => {
      if (node.name.startsWith('wheel-')) this.all.push(node);
      if (!/^wheel-(front|back)-(left|right)$/.test(node.name)) return;
      const size = new Box3().setFromObject(node).getSize(new Vector3());
      this.road.push({
        node,
        base: node.quaternion.clone(),
        front: node.name.startsWith('wheel-front-'),
        radius: Math.max(0.01, size.y / 2),
        spin: 0,
        index:
          (node.name.startsWith('wheel-front-') ? 0 : 2) + (node.name.endsWith('-right') ? 1 : 0),
        baseY: node.position.y,
        scaleY: Math.max(0.001, node.parent?.getWorldScale(new Vector3()).y ?? 1),
        travel: 0,
      });
    });
  }

  update(pose: WheelPose, dt: number) {
    this.delta.copy(pose.position).sub(this.previousPosition);
    this.rotation.copy(pose.rotation);
    // Respawns, first snapshots and phase changes must never turn a teleport into wheel travel.
    const continuous = this.sampled && dt > 0 && this.delta.lengthSq() < 12 ** 2;
    if (!continuous) this.rollingSpeed = 0;
    let distance = 0;
    if (pose.moving && continuous) {
      if (pose.grounded) {
        this.heading.copy(this.previousRotation).slerp(this.rotation, 0.5);
        this.forward.set(0, 0, 1).applyQuaternion(this.heading);
        distance = this.delta.dot(this.forward);
        this.rollingSpeed = distance / dt;
      } else {
        // Airborne tyres retain their takeoff spin instead of reacting to falling/sliding speed.
        distance = this.rollingSpeed * dt;
      }
    }
    this.previousPosition.copy(pose.position);
    this.previousRotation.copy(pose.rotation);
    this.sampled = true;

    for (const wheel of this.road) {
      const travel = pose.suspension?.[wheel.index] ?? 0;
      if (!continuous) wheel.travel = travel;
      else if (pose.moving) wheel.travel += (travel - wheel.travel) * (1 - Math.exp(-dt * 25));
      wheel.node.position.y = wheel.baseY + wheel.travel / wheel.scaleY;
      wheel.spin = (wheel.spin + distance / wheel.radius) % (Math.PI * 2);
      this.turn.setFromAxisAngle(this.up, wheel.front ? pose.steering * 0.52 : 0);
      this.roll.setFromAxisAngle(this.axle, wheel.spin);
      wheel.node.quaternion.copy(this.turn).multiply(wheel.base).multiply(this.roll);
    }
  }
}
