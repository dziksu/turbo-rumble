export const MAX_PLAYERS = 8;
export const PHYSICS_HZ = 50;
export const PHYSICS_STEP_SECONDS = 1 / PHYSICS_HZ;
export const SNAPSHOT_INTERVAL_TICKS = 2;
export const STARTING_SCORE = 5;
export const WINNING_SCORE = 10;
export const LAP_LIMIT = 3;
// A stable reference prevents redesigning one map from shortening another map’s race timeout.
export const RACE_TIMEOUT_REFERENCE_METRES = 900;
export const COUNTDOWN_TICKS = 10 * PHYSICS_HZ;
export const SUMMARY_DELAY_TICKS = PHYSICS_HZ;
export const ROUND_SUMMARY_TICKS = 2.8 * PHYSICS_HZ;
export const STALE_INPUT_TICKS = 12;
export const DISCONNECTED_PLAYER_TICKS = 2 * PHYSICS_HZ;

export const CAR_MASS = 200;
export const VEHICLE_RIDE_HEIGHT = 0.69;

export const PICKUP_RADIUS = 0.82;
export const PICKUP_RESPAWN_TICKS = 5 * PHYSICS_HZ;
export const MINE_OWNER_PROTECTION_TICKS = 3 * PHYSICS_HZ;
export const FROST_DURATION_TICKS = 1.6 * PHYSICS_HZ;

export const PROJECTILE_RANGE = Object.freeze({ rocket: 28, frost: 24 });
export const PULSE = Object.freeze({
  radius: 8,
  minimumPushSpeed: 8,
  maximumPushSpeed: 28,
  liftSpeed: 2.6,
  hitTicks: 0.6 * PHYSICS_HZ,
});

export const NITRO_EXHAUST = Object.freeze({ rearOffset: 1.7, length: 1.6, radius: 0.38 });
