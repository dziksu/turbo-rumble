export const AUDIO_FILES = {
  engine: ['engine.wav'],
  skid: ['tire-skid.wav'],
  collisionHeavy: ['collision-heavy.wav'],
  collisionLight: ['collision-light.wav'],
  explosion: ['explosion.wav'],
  boost: ['boost.wav'],
  frostShot: ['frost-shot.wav'],
  pulse: ['pulse.wav'],
  music: ['pixel-sprinter.ogg', 'pixel-sprinter.mp3'],
} as const;
export type AudioAsset = keyof typeof AUDIO_FILES;
export type AudioSamples = Partial<Record<AudioAsset, AudioBuffer>>;

/** A missing/unsupported file falls back independently; it never blocks the other sounds or play. */
export async function loadAudioSamples(context: BaseAudioContext, signal?: AbortSignal) {
  const samples: AudioSamples = {};
  await Promise.all(
    (Object.keys(AUDIO_FILES) as AudioAsset[]).map(async (key) => {
      for (const file of AUDIO_FILES[key]) {
        try {
          const response = await fetch(`/assets/audio/${file}`, { signal });
          if (!response.ok) continue;
          samples[key] = await context.decodeAudioData(await response.arrayBuffer());
          return;
        } catch {
          if (signal?.aborted) return;
        }
      }
    }),
  );
  return samples;
}
