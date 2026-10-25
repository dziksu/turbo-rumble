import { BiomeScenery } from './biome-scenery.ts';
import * as T from 'three';
import type { Track } from '../shared/track.ts';

export const PALETTES = {
  desert: {
    sky: '#efd3a3',
    ground: '#a5492c',
    road: '#dba96a',
    shoulder: '#ba683a',
    wall: '#984326',
    curb: '#b9492e',
    light: '#fff0c7',
  },
  forest: {
    sky: '#9eb7a9',
    ground: '#385b40',
    road: '#ae9164',
    shoulder: '#637247',
    wall: '#6b563d',
    curb: '#c7b990',
    light: '#e9fff0',
  },
  volcano: {
    sky: '#9ccfd0',
    ground: '#2c5149',
    road: '#343c3e',
    shoulder: '#697249',
    wall: '#3b464b',
    curb: '#e0cf9c',
    light: '#ffe8b8',
  },
} as const;
export function addBiome(parent: T.Group, track: Track, label: (text: string) => T.Sprite) {
  if (track.id === 'desert') return null;
  const root = new T.Group();
  root.name = track.id + '-biome-scenery';
  parent.add(root);
  return new BiomeScenery(root, track, label);
}
