import type { RaceSettings } from './maps.ts';
export type Weapon = 'boost' | 'rocket' | 'mine' | 'frost' | 'pulse';
export type Phase = 'lobby' | 'countdown' | 'racing' | 'segment' | 'finished' | 'paused';
export interface Vec {
  x: number;
  y: number;
  z: number;
}
export interface Rotation {
  x: number;
  y: number;
  z: number;
  w: number;
}
export interface Input {
  seq: number;
  left: boolean;
  right: boolean;
  actionSeq: number;
}
export interface CarState {
  id: string;
  name: string;
  color: string;
  slot: number;
  bot: boolean;
  connected: boolean;
  ready: boolean;
  alive: boolean;
  /** 1 or 2 after completing a last-two duel; zero before finishing. */
  finishPlace?: number;
  score: number;
  wins: number;
  weapon: Weapon | null;
  progress: number;
  position: Vec;
  yaw: number;
  speed: number;
  frozen: boolean;
  boosted: boolean;
  invulnerable: boolean;
  rotation?: Rotation;
  wrecked?: boolean;
  steering?: number;
  drift?: number;
  slip?: number;
  grounded?: boolean;
  /** Wheel travel in metres: front left/right, rear left/right; positive is compression. */
  suspension?: number[];
  /** Automatic trailing-car speed bonus (0..0.30), independent of the nitro item. */
  catchUpBonus?: number;
}
export interface ProjectileState {
  id: number;
  kind: 'rocket' | 'frost' | 'mine';
  owner: string;
  position: Vec;
  yaw: number;
  armed: boolean;
  rotation?: Rotation;
}
export interface ObstacleState {
  id: number;
  position: Vec;
  rotation: Rotation;
}
export interface PickupState {
  id: number;
  position: Vec;
  active: boolean;
}
export interface GameEvent {
  id: number;
  tick: number;
  type:
    | 'shot'
    | 'explosion'
    | 'frost'
    | 'pulse'
    | 'pickup'
    | 'elimination'
    | 'round'
    | 'finish'
    | 'collision';
  position: Vec;
  text?: string;
  color?: string;
  weapon?: Weapon;
  strength?: number;
}
export interface Result {
  id: string;
  name: string;
  color: string;
  score: number;
  place: number;
  cupPoints: number;
}
export interface Snapshot {
  settings?: RaceSettings;
  adminId?: string | null;
  code: string;
  phase: Phase;
  tick: number;
  seconds: number;
  /** Authoritative tick when the round or final results may cover the race view. */
  summaryAt: number;
  lap: number;
  lapLimit: number;
  cameraProgress: number;
  cars: CarState[];
  projectiles: ProjectileState[];
  pickups: PickupState[];
  events: GameEvent[];
  results: Result[];
  round: number;
  message: string;
  canStart: boolean;
  obstacles?: ObstacleState[];
}
export interface Session {
  code: string;
  token: string;
  playerId?: string;
  role: 'host' | 'player';
}
export interface SpectatorSession {
  code: string;
  role: 'spectator';
}
export type ConnectionSession = Session | SpectatorSession;
export const COLORS = [
  '#ffbd43',
  '#41d9cb',
  '#f66b91',
  '#9295ff',
  '#85db63',
  '#ff8149',
  '#50b7fa',
  '#f4e7c9',
];
export const WEAPONS: Record<Weapon, { name: string; icon: string; color: string; help: string }> =
  {
    boost: {
      name: 'Nitro',
      icon: 'ϟ',
      color: '#ffc44a',
      help: 'Przyspiesza. Płomień z tyłu spala rywali.',
    },
    rocket: {
      name: 'Rakieta',
      icon: '➚',
      color: '#ff8554',
      help: 'Pocisk do przodu. Trafienie eliminuje.',
    },
    mine: { name: 'Mina', icon: '✹', color: '#ec77a6', help: 'Pułapka za samochodem' },
    frost: {
      name: 'Mróz',
      icon: '❄',
      color: '#83ddff',
      help: 'Zamraża sterowanie na 1,6 s. Auto zachowuje prędkość.',
    },
    pulse: { name: 'Impuls', icon: '◎', color: '#b9a1ff', help: 'Odpycha auta wokół ciebie' },
  };
