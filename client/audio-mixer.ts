/** Headroom after the compressor keeps stacked impacts comfortable on a shared TV/speakers. */
export function createMixOutput(context: BaseAudioContext, destination: AudioNode) {
  const compressor = context.createDynamicsCompressor(),
    headroom = context.createGain();
  compressor.threshold.value = -14;
  compressor.knee.value = 12;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.001;
  compressor.release.value = 0.18;
  headroom.gain.value = 0.78;
  compressor.connect(headroom).connect(destination);
  return compressor;
}
