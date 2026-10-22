import { createMixOutput } from './audio-mixer.ts';
import { loadAudioSamples, type AudioSamples } from './audio-assets.ts';
import { MusicLoop } from './music-audio.ts';
import { VehicleVoice } from './vehicle-audio.ts';
export { EngineVoice } from './vehicle-audio.ts';
import type { GameEvent, Snapshot } from '../shared/types.ts';

export const SOUND_EFFECTS = [
  'countdown',
  'start',
  'pickup',
  'boost',
  'rocket',
  'mine',
  'frost-shot',
  'frost',
  'pulse',
  'explosion',
  'elimination',
  'collision',
  'round',
  'lap',
  'finish',
  'ready',
] as const;
export type SoundEffect = (typeof SOUND_EFFECTS)[number];
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(context: BaseAudioContext) {
  let buffer = noiseCache.get(context);
  if (buffer) return buffer;
  buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 2), context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x147ad;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    data[i] = (seed >>> 0) / 2147483648 - 1;
  }
  noiseCache.set(context, buffer);
  return buffer;
}

// The same Web Audio graph is used by the live game and the offline audio check.
export function renderEffect(
  context: BaseAudioContext,
  output: AudioNode,
  effect: SoundEffect,
  at = context.currentTime,
  intensity = 1,
  pan = 0,
  samples: AudioSamples = {},
) {
  const bus = context.createGain(),
    panner = context.createStereoPanner();
  bus.gain.value = clamp(intensity, 0, 1);
  panner.pan.value = clamp(pan, -1, 1);
  bus.connect(panner).connect(output);
  const tone = (
    frequency: number,
    end: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'sine',
    delay = 0,
  ) => {
    const o = context.createOscillator(),
      g = context.createGain(),
      t = at + delay;
    o.type = type;
    o.frequency.setValueAtTime(frequency, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.007);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + duration + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  };
  const hiss = (
    duration: number,
    volume: number,
    cutoff: number,
    endCutoff: number,
    delay = 0,
    type: BiquadFilterType = 'lowpass',
  ) => {
    const source = context.createBufferSource(),
      filter = context.createBiquadFilter(),
      g = context.createGain(),
      t = at + delay;
    source.buffer = noise(context);
    filter.type = type;
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(endCutoff, t + duration);
    filter.Q.value = 0.8;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(g).connect(bus);
    source.start(t);
    source.stop(t + duration + 0.02);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  };
  let longest = 1.4;
  const sample = (key: keyof AudioSamples, volume: number, rate = 1) => {
    const buffer = samples[key];
    if (!buffer) return false;
    const source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain).connect(bus);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start(at);
    longest = Math.max(longest, buffer.duration / rate + 0.04);
    return true;
  };
  switch (effect) {
    case 'countdown':
      tone(660, 650, 0.12, 0.13, 'square');
      break;
    case 'start':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone(f, f, 0.35, 0.1, 'triangle', i * 0.07),
      );
      break;
    case 'pickup':
      [880, 1174.66, 1567.98].forEach((f, i) => tone(f, f * 1.06, 0.16, 0.1, 'sine', i * 0.055));
      break;
    case 'boost':
      if (sample('boost', 0.65)) {
        tone(75, 220, 0.55, 0.12, 'triangle');
        break;
      }
      hiss(0.65, 0.32, 600, 6500, 0, 'bandpass');
      tone(85, 440, 0.6, 0.14, 'sawtooth');
      break;
    case 'rocket':
      if (sample('boost', 0.65, 1.6)) {
        tone(130, 45, 0.25, 0.16, 'triangle');
        break;
      }
      hiss(0.28, 0.35, 5500, 550);
      tone(230, 65, 0.28, 0.12, 'sawtooth');
      break;
    case 'mine':
      sample('collisionLight', 0.55, 1.2);
      tone(150, 60, 0.11, 0.19, 'triangle');
      tone(1050, 900, 0.11, 0.09, 'sine', 0.12);
      break;
    case 'frost-shot':
      if (sample('frostShot', 0.65, 1.18)) break;
      tone(1800, 480, 0.3, 0.12, 'sine');
      hiss(0.25, 0.2, 7500, 2200, 0, 'highpass');
      break;
    case 'frost':
      [2400, 3100, 3900].forEach((f, i) => tone(f, f * 0.7, 0.32, 0.075, 'sine', i * 0.04));
      hiss(0.35, 0.18, 8000, 3000, 0, 'highpass');
      break;
    case 'pulse':
      if (sample('pulse', 0.65)) {
        tone(80, 32, 0.55, 0.2);
        break;
      }
      tone(95, 38, 0.45, 0.3, 'sine');
      tone(360, 55, 0.38, 0.12, 'triangle');
      hiss(0.25, 0.15, 600, 1800, 0, 'bandpass');
      break;
    case 'explosion':
      if (sample('explosion', 0.85)) {
        tone(70, 26, 0.65, 0.22);
        break;
      }
      hiss(0.75, 0.55, 3500, 120);
      tone(90, 27, 0.6, 0.28, 'sine');
      break;
    case 'elimination':
      tone(430, 60, 0.48, 0.1, 'sawtooth');
      tone(510, 80, 0.4, 0.07, 'triangle', 0.05);
      break;
    case 'collision':
      if (
        sample(intensity > 0.55 ? 'collisionHeavy' : 'collisionLight', 0.7, 0.94 + intensity * 0.12)
      ) {
        tone(85, 38, 0.17, 0.13, 'triangle');
        break;
      }
      hiss(0.13, 0.42, 1800, 180);
      tone(95, 42, 0.15, 0.17, 'triangle');
      break;
    case 'round':
      [392, 523.25, 659.25].forEach((f, i) => tone(f, f, 0.19, 0.09, 'triangle', i * 0.09));
      break;
    case 'lap':
      [659.25, 783.99, 1046.5].forEach((f, i) => tone(f, f, 0.24, 0.09, 'triangle', i * 0.11));
      break;
    case 'finish':
      [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) =>
        tone(f, f, 0.36, 0.12, 'triangle', i * 0.14),
      );
      tone(261.63, 261.63, 1.15, 0.07, 'sine');
      break;
    case 'ready':
      tone(440, 660, 0.1, 0.08, 'sine');
      tone(880, 880, 0.12, 0.07, 'sine', 0.08);
      break;
  }
  const cleanup = context.createConstantSource();
  cleanup.offset.value = 0;
  cleanup.connect(bus);
  cleanup.start(at);
  cleanup.stop(at + longest);
  cleanup.onended = () => {
    cleanup.disconnect();
    bus.disconnect();
    panner.disconnect();
  };
}

export function effectForEvent(event: GameEvent): SoundEffect {
  if (event.type === 'shot')
    return event.weapon === 'boost'
      ? 'boost'
      : event.weapon === 'mine'
        ? 'mine'
        : event.weapon === 'frost'
          ? 'frost-shot'
          : 'rocket';
  return event.type;
}

export class Sound {
  context: AudioContext | null = null;
  enabled = true;
  volume = 0.65;
  musicEnabled = true;
  musicVolume = 0.28;
  master: GainNode | null = null;
  music: MusicLoop | null = null;
  onChange = () => {};
  private hidden = false;
  private lastEvent = 0;
  private phase = '';
  private lap = 1;
  private countdown = -1;
  private lastTick = -1;
  private recent: number[] = [];
  private samples: AudioSamples = {};
  private vehicles = new Map<string, VehicleVoice>();
  private output: GainNode | null = null;
  private abort = new AbortController();
  private disposed = false;
  private musicDuckedUntil = 0;
  private lastState: Snapshot | null = null;
  private playerId?: string | null;
  samplesReady: Promise<void> = Promise.resolve();
  constructor() {
    try {
      if (typeof window !== 'undefined') {
        this.enabled = localStorage.getItem('turbo:sound') !== 'off';
        this.musicEnabled = localStorage.getItem('turbo:music') !== 'off';
        for (const [key, field] of [
          ['turbo:volume', 'volume'],
          ['turbo:music-volume', 'musicVolume'],
        ] as const) {
          const saved = localStorage.getItem(key);
          if (saved !== null && Number.isFinite(Number(saved)))
            this[field] = clamp(Number(saved), 0, 1);
        }
        this.hidden = document.hidden;
      }
    } catch {
      /* Storage/audio is optional; gameplay remains available. */
    }
  }
  get active() {
    return this.enabled && !this.hidden && this.context?.state === 'running';
  }
  async unlock() {
    if (!this.enabled || this.disposed) return false;
    if (!this.context) {
      const c = (this.context = new AudioContext());
      this.master = c.createGain();
      this.master.gain.value = 0;
      this.master.connect(c.destination);
      const mix = createMixOutput(c, this.master);
      this.output = c.createGain();
      this.output.gain.value = this.volume;
      this.output.connect(mix);
      c.onstatechange = () => {
        this.applyVolume();
        this.onChange();
      };
      this.samplesReady = loadAudioSamples(c, this.abort.signal).then((samples) => {
        if (this.disposed) return;
        this.samples = samples;
        this.clearVehicles();
        if (samples.music) this.music = new MusicLoop(c, mix, samples.music);
        if (this.lastState) this.updateVehicles(this.lastState, this.playerId);
        this.applyVolume();
        this.onChange();
      });
    }
    if (this.context.state !== 'running') await this.context.resume();
    this.applyVolume();
    this.onChange();
    return this.active;
  }
  private applyVolume() {
    if (this.context && this.master && this.output) {
      this.master.gain.setTargetAtTime(this.active ? 1 : 0, this.context.currentTime, 0.025);
      this.output.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.025);
      const phaseLevel =
        this.phase === 'racing'
          ? 1
          : this.phase === 'countdown'
            ? 0.4
            : this.phase === 'paused'
              ? 0.35
              : 0.7;
      const duck = this.context.currentTime < this.musicDuckedUntil ? 0.5 : 1;
      this.music?.setLevel(this.musicVolume * phaseLevel * duck);
      this.music?.setPlaying(!!this.active && this.musicEnabled && this.musicVolume > 0);
    }
  }
  private save(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Optional browser storage. */
    }
  }
  async toggle() {
    if (this.active) this.enabled = false;
    else {
      this.enabled = true;
      await this.unlock();
    }
    this.applyVolume();
    this.save('turbo:sound', this.enabled ? 'on' : 'off');
    this.onChange();
    return this.active;
  }
  async toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    if (this.musicEnabled && this.enabled) await this.unlock();
    this.save('turbo:music', this.musicEnabled ? 'on' : 'off');
    this.applyVolume();
    this.onChange();
  }
  setVolume(volume: number) {
    this.volume = clamp(volume, 0, 1);
    this.save('turbo:volume', String(this.volume));
    this.applyVolume();
  }
  setMusicVolume(volume: number) {
    this.musicVolume = clamp(volume, 0, 1);
    this.save('turbo:music-volume', String(this.musicVolume));
    this.applyVolume();
    this.onChange();
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.applyVolume();
    this.onChange();
  }
  play(effect: SoundEffect, intensity = 1, pan = 0) {
    if (!this.active || !this.context || !this.output) return;
    const now = this.context.currentTime;
    this.recent = this.recent.filter((t) => now - t < 0.12);
    if (this.recent.length >= 8 && ['collision', 'elimination', 'pickup'].includes(effect)) return;
    this.recent.push(now);
    if (['explosion', 'finish', 'start'].includes(effect)) this.musicDuckedUntil = now + 0.7;
    renderEffect(this.context, this.output, effect, now, clamp(intensity, 0, 1), pan, this.samples);
  }
  private clearVehicles() {
    for (const voice of this.vehicles.values()) voice.dispose();
    this.vehicles.clear();
  }
  private updateVehicles(state: Snapshot, playerId?: string | null) {
    if (!this.context || !this.output) return;
    const alive = state.cars.filter((car) => car.alive);
    const focus =
      alive.find((car) => car.id === playerId) ??
      [...alive].sort((a, b) => b.progress - a.progress)[0];
    const count = Math.max(1, alive.length);
    for (const [id, voice] of this.vehicles)
      if (!state.cars.some((car) => car.id === id)) {
        voice.dispose();
        this.vehicles.delete(id);
      }
    for (const car of state.cars.slice(0, 8)) {
      let voice = this.vehicles.get(car.id);
      if (!voice) {
        voice = new VehicleVoice(this.context, this.output, this.samples, car.slot);
        this.vehicles.set(car.id, voice);
      }
      const dx = focus ? car.position.x - focus.position.x : 0;
      const dz = focus ? car.position.z - focus.position.z : 0;
      const pan = focus
        ? clamp((dx * Math.cos(focus.yaw) - dz * Math.sin(focus.yaw)) / 22, -0.8, 0.8)
        : 0;
      const level = (clamp(1 - Math.hypot(dx, dz) / 65, 0, 1) * 0.7) / Math.sqrt(count);
      voice.set(car, state.phase === 'racing', level, pan);
    }
  }
  update(state: Snapshot, playerId?: string | null) {
    this.lastState = state;
    this.playerId = playerId;
    if (state.tick < this.lastTick) {
      this.lastEvent = 0;
      this.phase = '';
      this.countdown = -1;
      this.lap = 1;
    }
    this.lastTick = state.tick;
    if (state.phase === 'countdown') {
      const n = Math.ceil(state.seconds);
      if (n > 0 && n !== this.countdown) {
        this.countdown = n;
        this.play('countdown');
      }
    } else this.countdown = -1;
    if (state.phase === 'racing' && this.phase === 'countdown') this.play('start');
    if (state.phase === 'racing' && this.phase === 'segment') this.play('ready');
    if (state.phase === 'racing' && state.lap > this.lap) this.play('lap');
    const driver =
      state.cars.find((c) => c.id === playerId && c.alive) ??
      [...state.cars].filter((c) => c.alive).sort((a, b) => b.progress - a.progress)[0];
    for (const event of state.events)
      if (event.id > this.lastEvent) {
        this.lastEvent = event.id;
        if (state.tick - event.tick >= 12 || (event.type === 'round' && state.phase === 'finished'))
          continue;
        let volume = event.strength ?? 1,
          pan = 0;
        if (driver) {
          const dx = event.position.x - driver.position.x,
            dz = event.position.z - driver.position.z;
          volume *= clamp(1 - Math.hypot(dx, dz) / 70, 0.25, 1);
          pan = clamp((dx * Math.cos(driver.yaw) - dz * Math.sin(driver.yaw)) / 18, -0.8, 0.8);
        }
        this.play(effectForEvent(event), volume, pan);
      }
    this.updateVehicles(state, playerId);
    this.phase = state.phase;
    this.lap = state.lap;
    this.applyVolume();
  }
  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.clearVehicles();
    this.music?.dispose();
    this.music = null;
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close();
    }
    this.context = null;
  }
}
