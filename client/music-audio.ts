/** One loop with a retained playhead: snapshots never restart the music. */
export class MusicLoop {
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  private startedAt = 0;
  private offset = 0;
  private level = 0;
  constructor(
    private context: BaseAudioContext,
    output: AudioNode,
    public buffer: AudioBuffer,
  ) {
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(output);
  }
  get playing() {
    return this.source !== null;
  }
  get position() {
    return (
      (this.offset + (this.source ? this.context.currentTime - this.startedAt : 0)) %
      this.buffer.duration
    );
  }
  setLevel(level: number, at = this.context.currentTime) {
    this.level = Math.max(0, Math.min(1, level));
    this.gain.gain.setTargetAtTime(this.source ? this.level : 0, at, 0.12);
  }
  setPlaying(playing: boolean, at = this.context.currentTime) {
    if (playing === this.playing) return;
    if (playing) {
      const source = this.context.createBufferSource();
      source.buffer = this.buffer;
      source.loop = true;
      source.connect(this.gain);
      source.onended = () => source.disconnect();
      source.start(at, this.offset);
      this.source = source;
      this.startedAt = at;
      this.gain.gain.setTargetAtTime(this.level, at, 0.18);
    } else {
      this.offset = (this.offset + at - this.startedAt) % this.buffer.duration;
      this.gain.gain.setTargetAtTime(0, at, 0.012);
      this.source!.stop(at + 0.08);
      this.source = null;
    }
  }
  dispose() {
    this.source?.stop();
    this.source = null;
    this.gain.disconnect();
  }
}
