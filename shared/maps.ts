export type MapId = 'desert' | 'forest' | 'volcano';
interface MapDefinition {
  name: string;
  subtitle: string;
  roadWidth: number;
  points: [number, number][];
  gaps: { u: number; length: number; kind: 'river' | 'lava' }[];
}
export const MAPS: Record<MapId, MapDefinition> = {
  desert: {
    name: 'Sundown Junction',
    subtitle: 'Miasteczko · place i mosty',
    roadWidth: 9,
    points: [
      [-132, -100],
      [-38, -110],
      [58, -95],
      [115, -78],
      [164, -28],
      [171, 48],
      [110, 98],
      [42, 110],
      [0, 82],
      [-42, 78],
      [-83, 116],
      [-150, 108],
      [-186, 40],
      [-180, -30],
      [-167, -78],
    ],
    gaps: [],
  },
  forest: {
    name: 'Timber Run',
    subtitle: 'Las · kłody i skoki nad rzeką',
    roadWidth: 9,
    points: [
      [-130, -100],
      [-40, -120],
      [80, -110],
      [150, -65],
      [165, 10],
      [120, 65],
      [60, 90],
      [20, 135],
      [-65, 135],
      [-150, 95],
      [-175, 20],
      [-150, -45],
    ],
    gaps: [
      { u: 0.18, length: 8, kind: 'river' },
      { u: 0.68, length: 8, kind: 'river' },
    ],
  },
  volcano: {
    name: 'Aloha Inferno',
    subtitle: 'Hawaje · wulkan i rzeki lawy',
    roadWidth: 8.5,
    points: [
      [-145, -100],
      [-45, -140],
      [75, -125],
      [160, -60],
      [180, 35],
      [120, 115],
      [20, 155],
      [-90, 135],
      [-175, 65],
      [-185, -25],
    ],
    gaps: [
      { u: 0.2, length: 10, kind: 'lava' },
      { u: 0.67, length: 10, kind: 'lava' },
    ],
  },
};
export interface RaceSettings {
  mapId: MapId;
  lapLimit: number;
  winningScore: number;
}
export const DEFAULT_SETTINGS: RaceSettings = { mapId: 'desert', lapLimit: 3, winningScore: 10 };
