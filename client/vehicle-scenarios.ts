// Dev-only fixtures for inspecting the same eight-body simulation used by the server.
import { Quaternion, Vector3 } from 'three';
import { Race } from '../shared/simulation.ts';
import { DRIVING } from '../shared/driving.ts';
import { VEHICLE_RIDE_HEIGHT } from '../shared/rules.ts';
import type { MapId } from '../shared/maps.ts';

export type VehicleScenario = 'jump' | 'landing' | 'collision';

export function vehicleScenario(mapId: MapId, scenario: VehicleScenario) {
  const race = new Race(271, { mapId, lapLimit: 9, winningScore: 50 });
  const ramp = race.track.RAMPS[0];
  const progress = scenario === 'collision' ? 80 : ramp.s;
  const at = race.track.trackAt(progress);
  const airborne = new Set<string>(),
    landings = new Map<string, number>();
  for (let slot = 0; slot < 8; slot++)
    race.addDriver({
      id: `lab${slot}`,
      name: `Rapier ${slot + 1}`,
      slot,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  for (const car of race.cars.values()) {
    const opposing = scenario === 'collision' && car.slot >= 4;
    const along =
      scenario === 'collision'
        ? opposing
          ? 4
          : -4
        : -ramp.length / 2 - 4 - Math.floor(car.slot / 4) * 5;
    const point = at.p
      .clone()
      .addScaledVector(at.t, along)
      .addScaledVector(at.n, ((car.slot % 4) - 1.5) * 2.7);
    const yaw = at.yaw + (opposing ? Math.PI : 0);
    car.body.setTranslation({ ...point, y: VEHICLE_RIDE_HEIGHT }, true);
    car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), true);
    car.body.setLinvel(
      { x: Math.sin(yaw) * DRIVING.speed, y: 0, z: Math.cos(yaw) * DRIVING.speed },
      true,
    );
    car.progress = progress + along;
    car.invulnerableUntil = Infinity;
  }
  race.world.step();
  for (let tick = 0; tick < 200; tick++) {
    for (const car of race.cars.values())
      race.input(car.id, { seq: tick + 1, left: false, right: false, actionSeq: 0 });
    race.step();
    for (const car of race.cars.values()) {
      if (!car.grounded && car.body.translation().y > 3.5) airborne.add(car.id);
      if (
        airborne.has(car.id) &&
        car.grounded &&
        car.body.translation().y < 0.95 &&
        !landings.has(car.id)
      )
        landings.set(car.id, tick);
    }
    if (scenario === 'collision' && tick === 16) break;
    if (scenario === 'jump' && airborne.size === 8) break;
    if (
      scenario === 'landing' &&
      landings.size === 8 &&
      [...landings.values()].every((landing) => tick - landing >= 15)
    )
      break;
  }
  race.cameraProgress = race.cars.get('lab0')!.progress - 4;
  race.pause();
  return race;
}
