import type { CarState } from '../shared/types.ts';
import type { AudioSamples } from './audio-assets.ts';

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export function engineDrive(speed: number, boosted = false) {
  const velocity = clamp(Math.abs(speed), 0, 42);
  const gear = Math.floor(Math.max(0, velocity - 2) / 8);
  return {
    rate: (0.8 + (velocity - gear * 6) * 0.047) * (boosted ? 1.12 : 1),
    bass: 38 + velocity * 1.8,
    cutoff: 600 + velocity * 65,
  };
}

/** Steering alone is not tyre slip. Airborne, dead and stationary cars must not squeal. */
export function tyreSlip(car: Pick<CarState, 'alive' | 'grounded' | 'speed' | 'slip'>) {
  if (!car.alive || car.grounded !== true) return 0;
  return (
    clamp((Math.abs(car.slip ?? 0) - 0.09) / 0.55, 0, 1) *
    clamp((Math.abs(car.speed) - 5) / 10, 0, 1)
  );
}

export class EngineVoice {
  private gain: GainNode;
  private filter: BiquadFilterNode;
  private bass: OscillatorNode;
  private source: AudioBufferSourceNode | OscillatorNode;
  constructor(
    public context: BaseAudioContext,
    output: AudioNode,
    buffer?: AudioBuffer,
    private variation = 1,
  ) {
    const c = context;
    this.gain = c.createGain();
    this.gain.gain.value = 0;
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.5;
    this.filter.frequency.value = 600;
    this.filter.connect(this.gain).connect(output);
    const body = c.createGain();
    body.gain.value = buffer ? 0.3 : 0.13;
    if (buffer) {
      const source = c.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      this.source = source;
    } else {
      const source = c.createOscillator();
      source.type = 'sawtooth';
      this.source = source;
    }
    this.source.connect(body).connect(this.filter);
    this.source.onended = () => {
      this.source.disconnect();
      body.disconnect();
    };
    // A quiet subharmonic gives the recorded motor weight without masking impacts.
    this.bass = c.createOscillator();
    this.bass.type = 'sine';
    const bassGain = c.createGain();
    bassGain.gain.value = 0.045;
    this.bass.connect(bassGain).connect(this.filter);
    this.bass.onended = () => {
      this.bass.disconnect();
      bassGain.disconnect();
      this.filter.disconnect();
      this.gain.disconnect();
    };
    this.source.start();
    this.bass.start();
  }
  set(speed: number, active: boolean, boosted = false, at = this.context.currentTime) {
    const drive = engineDrive(speed, boosted);
    if ('playbackRate' in this.source)
      this.source.playbackRate.setTargetAtTime(drive.rate * this.variation, at, 0.09);
    else this.source.frequency.setTargetAtTime(drive.bass * 1.7 * this.variation, at, 0.09);
    this.bass.frequency.setTargetAtTime(drive.bass * this.variation, at, 0.09);
    this.filter.frequency.setTargetAtTime(drive.cutoff, at, 0.1);
    this.gain.gain.setTargetAtTime(active ? (boosted ? 1.1 : 1) : 0, at, 0.035);
  }
  dispose() {
    const at = this.context.currentTime;
    this.gain.gain.setTargetAtTime(0, at, 0.015);
    this.source.stop(at + 0.08);
    this.bass.stop(at + 0.08);
  }
}

export class VehicleVoice {
  private engine: EngineVoice;
  private skid: AudioBufferSourceNode | null = null;
  private skidGain: GainNode;
  private pan: StereoPannerNode;
  private gain: GainNode;
  constructor(
    private context: BaseAudioContext,
    output: AudioNode,
    samples: AudioSamples,
    slot: number,
  ) {
    this.pan = context.createStereoPanner();
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.pan.connect(this.gain).connect(output);
    this.engine = new EngineVoice(context, this.pan, samples.engine, 0.96 + (slot % 4) * 0.027);
    this.skidGain = context.createGain();
    this.skidGain.gain.value = 0;
    this.skidGain.connect(this.pan);
    if (samples.skid) {
      this.skid = context.createBufferSource();
      this.skid.buffer = samples.skid;
      this.skid.loop = true;
      this.skid.connect(this.skidGain);
      const source = this.skid;
      source.onended = () => {
        source.disconnect();
        this.skidGain.disconnect();
        this.pan.disconnect();
        this.gain.disconnect();
      };
      source.start(0, (slot * 0.29) % samples.skid.duration);
    }
  }
  set(car: CarState, racing: boolean, level: number, pan: number, at = this.context.currentTime) {
    const active = racing && car.alive && car.connected;
    this.engine.set(car.speed, active, car.boosted, at);
    this.gain.gain.setTargetAtTime(level, at, 0.07);
    this.pan.pan.setTargetAtTime(pan, at, 0.07);
    this.skidGain.gain.setTargetAtTime(active ? tyreSlip(car) * 0.55 : 0, at, 0.045);
    this.skid?.playbackRate.setTargetAtTime(0.88 + Math.abs(car.speed) * 0.012, at, 0.09);
  }
  dispose() {
    this.engine.dispose();
    this.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.015);
    if (this.skid) this.skid.stop(this.context.currentTime + 0.08);
    else {
      this.skidGain.disconnect();
      this.pan.disconnect();
      this.gain.disconnect();
    }
  }
}
