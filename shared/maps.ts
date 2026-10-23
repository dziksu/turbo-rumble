export type MapId = 'desert' | 'forest' | 'volcano';
interface MapDefinition {
  name: string;
  subtitle: string;
  roadWidth: number;
  points: [number, number][];
  gaps: { u: number; length: number; kind: 'river' | 'lava' | 'canyon' }[];
}
export const MAPS: Record<MapId, MapDefinition> = {
  desert: {
    name: 'Sundown Junction',
    subtitle: 'Kanion · serpentyny i skok nad wąwozem',
    roadWidth: 7,
    points: [
      [0, 165],
      [90, 165],
      [150, 164],
      [176, 143],
      [172, 105],
      [154, 65],
      [155, 10],
      [155, -55],
      [150, -115],
      [127, -151],
      [92, -151],
      [76, -125],
      [88, -88],
      [91, -58],
      [67, -40],
      [33, -61],
      [8, -85],
      [-28, -87],
      [-60, -68],
      [-91, -72],
      [-107, -94],
      [-85, -117],
      [-55, -128],
      [-55, -150],
      [-91, -165],
      [-132, -156],
      [-149, -131],
      [-128, -104],
      [-142, -77],
      [-170, -51],
      [-176, -17],
      [-146, 10],
      [-147, 38],
      [-177, 65],
      [-169, 106],
      [-177, 142],
      [-149, 165],
      [-75, 165],
    ],
    gaps: [{ u: 0.192, length: 8, kind: 'canyon' }],
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
