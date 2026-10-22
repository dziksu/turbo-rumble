import { loadAudioSamples } from './audio-assets.ts';
import { MusicLoop } from './music-audio.ts';
import { createMixOutput } from './audio-mixer.ts';
import { VehicleVoice, tyreSlip } from './vehicle-audio.ts';
import type { CarState } from '../shared/types.ts';
import { EngineVoice, renderEffect, SOUND_EFFECTS } from './audio.ts';

interface Measurement {
  effect: string;
  peak: number;
  rms: number;
  tail: number;
  pass: boolean;
}
const sampleRate = 24000,
  duration = 2.4;
const measure = (effect: string, buffer: AudioBuffer): Measurement => {
  let peak = 0,
    square = 0,
    tail = 0,
    finite = true;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      finite &&= Number.isFinite(data[i]);
      const n = Math.abs(data[i]);
      peak = Math.max(peak, n);
      square += n * n;
      if (i > data.length - sampleRate * 0.1) tail = Math.max(tail, n);
    }
  }
  const rms = Math.sqrt(square / (buffer.length * buffer.numberOfChannels));
  return {
    effect,
    peak,
    rms,
    tail,
    pass: finite && peak > 0.005 && peak < 0.99 && rms > 0.0005 && tail < 0.001,
  };
};
function wav(buffers: AudioBuffer[]) {
  const length = buffers.reduce((n, b) => n + b.length, 0),
    array = new ArrayBuffer(44 + length * 4),
    view = new DataView(array);
  let at = 0;
  const text = (s: string) => {
    for (const c of s) view.setUint8(at++, c.charCodeAt(0));
  };
  text('RIFF');
  view.setUint32(at, length * 4 + 36, true);
  at += 4;
  text('WAVEfmt ');
  view.setUint32(at, 16, true);
  at += 4;
  view.setUint16(at, 1, true);
  at += 2;
  view.setUint16(at, 2, true);
  at += 2;
  view.setUint32(at, sampleRate, true);
  at += 4;
  view.setUint32(at, sampleRate * 4, true);
  at += 4;
  view.setUint16(at, 4, true);
  at += 2;
  view.setUint16(at, 16, true);
  at += 2;
  text('data');
  view.setUint32(at, length * 4, true);
  at += 4;
  for (const b of buffers)
    for (let i = 0; i < b.length; i++)
      for (let c = 0; c < 2; c++) {
        view.setInt16(at, Math.max(-1, Math.min(1, b.getChannelData(c)[i])) * 32767, true);
        at += 2;
      }
  return array;
}
export function mountAudioCheck(app: HTMLElement) {
  document.body.className = 'audio-check';
  app.innerHTML = `<main style="max-width:1000px;margin:40px auto;padding:24px"><a href="/">← Turbo Rumble</a><p class="eyebrow">NARZĘDZIE QA</p><h1>Sprawdzenie efektów dźwiękowych</h1><p>Rzeczywisty OfflineAudioContext: sygnał, poziom szczytowy, wybrzmienie, stereo i miks wielu efektów. Podgląd używa tego samego kodu co gra.</p><button class="button primary" id="run-audio-check">Sprawdź i odtwórz efekty</button><p id="audio-status" role="status">Gotowe do sprawdzenia.</p><audio id="audio-sample" controls hidden style="width:100%"></audio><a id="audio-download" download="turbo-rumble-effects.wav" hidden>Pobierz próbkę WAV</a><canvas id="audio-wave" width="960" height="130" style="width:100%;margin-top:20px"></canvas><table style="width:100%;text-align:left"><thead><tr><th>Efekt</th><th>Peak</th><th>RMS</th><th>Ogon</th><th>Wynik</th></tr></thead><tbody id="audio-rows"></tbody></table><details><summary>Raport JSON</summary><pre id="audio-report" style="white-space:pre-wrap"></pre></details></main>`;
  const button = document.querySelector<HTMLButtonElement>('#run-audio-check')!,
    status = document.querySelector('#audio-status')!;
  button.onclick = async () => {
    button.disabled = true;
    status.textContent = 'Renderowanie i pomiar…';
    try {
      const live = new AudioContext();
      await live.resume();
      const samples = await loadAudioSamples(live);
      const missing = Object.keys({
        engine: 1,
        skid: 1,
        collisionHeavy: 1,
        collisionLight: 1,
        explosion: 1,
        boost: 1,
        frostShot: 1,
        pulse: 1,
        music: 1,
      }).filter((key) => !(key in samples));
      if (missing.length) throw new Error('Missing audio: ' + missing.join(', '));
      const gain = live.createGain();
      gain.gain.value = 0.45;
      gain.connect(live.destination);
      let when = live.currentTime + 0.1;
      for (const effect of SOUND_EFFECTS) {
        renderEffect(live, gain, effect, when, 1, 0, samples);
        when += duration;
      }
      const buffers: AudioBuffer[] = [],
        rows: Measurement[] = [];
      for (const effect of SOUND_EFFECTS) {
        const context = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
        renderEffect(context, context.destination, effect, 0, 1, 0, samples);
        const buffer = await context.startRendering();
        buffers.push(buffer);
        rows.push(measure(effect, buffer));
      }
      const engineBuffers: AudioBuffer[] = [];
      for (const boost of [false, true]) {
        const context = new OfflineAudioContext(2, sampleRate * duration, sampleRate),
          voice = new EngineVoice(context, context.destination, samples.engine);
        voice.set(boost ? 24.3 : 18, true, boost, 0);
        voice.set(0, false, false, 0.85);
        const buffer = await context.startRendering();
        engineBuffers.push(buffer);
        rows.push(measure(boost ? 'engine with nitro' : 'engine at racing speed', buffer));
      }
      const muteContext = new OfflineAudioContext(2, sampleRate * duration, sampleRate),
        mute = muteContext.createGain();
      mute.gain.value = 0;
      mute.connect(muteContext.destination);
      new EngineVoice(muteContext, mute, samples.engine).set(18, true);
      renderEffect(muteContext, mute, 'explosion', 0, 1, 0, samples);
      const mutedMusic = new MusicLoop(muteContext, mute, samples.music!);
      mutedMusic.setLevel(0.28);
      mutedMusic.setPlaying(true);
      const muted = await muteContext.startRendering(),
        mutedPass =
          muted.getChannelData(0).every((n) => n === 0) &&
          muted.getChannelData(1).every((n) => n === 0);
      rows.push({
        effect: 'master mute silences engine, explosion and music',
        peak: 0,
        rms: 0,
        tail: 0,
        pass: mutedPass,
      });
      const stereo = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
      renderEffect(stereo, stereo.destination, 'pulse', 0, 1, -0.8, samples);
      const stereoBuffer = await stereo.startRendering();
      const energy = (n: number) =>
        stereoBuffer.getChannelData(n).reduce((sum, x) => sum + x * x, 0);
      const stereoPass = energy(0) > energy(1) * 4;
      const stress = new OfflineAudioContext(2, sampleRate * duration, sampleRate),
        compressor = createMixOutput(stress, stress.destination);
      for (let i = 0; i < 16; i++)
        renderEffect(stress, compressor, 'explosion', i * 0.012, 0.7, ((i % 3) - 1) * 0.6, samples);
      const stressResult = measure(
        '16 sampled explosions + limiter',
        await stress.startRendering(),
      );
      rows.push(stressResult);
      const car = {
        id: 'audio',
        slot: 0,
        alive: true,
        connected: true,
        grounded: true,
        speed: 19,
        slip: 0.6,
        boosted: false,
      } as CarState;
      for (const [name, overrides, expected] of [
        ['tyres during actual drift', {}, true],
        ['airborne tyres stay silent', { grounded: false }, false],
        ['straight driving tyres stay silent', { slip: 0 }, false],
        ['stationary tyres stay silent', { speed: 0 }, false],
        ['eliminated tyres stay silent', { alive: false }, false],
      ] as const) {
        const context = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
        const source = context.createBufferSource(),
          tyreGain = context.createGain();
        source.buffer = samples.skid!;
        source.loop = true;
        tyreGain.gain.value = tyreSlip({ ...car, ...overrides }) * 0.55;
        tyreGain.gain.setValueAtTime(tyreGain.gain.value, 0);
        tyreGain.gain.setTargetAtTime(0, 0.8, 0.03);
        source.connect(tyreGain).connect(context.destination);
        source.start();
        const result = measure(name, await context.startRendering());
        if (!expected) result.pass = result.peak === 0;
        rows.push(result);
      }
      const musicContext = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
      const music = new MusicLoop(musicContext, musicContext.destination, samples.music!);
      music.setLevel(0.28, 0);
      music.setPlaying(true, 0);
      music.setPlaying(true, 0.2);
      music.setPlaying(false, 0.5);
      music.setPlaying(true, 0.7);
      music.setPlaying(false, 1.1);
      const retained = Math.abs(music.position - 0.9) < 0.001;
      const musicResult = measure(
        'music pause/resume retains its playhead',
        await musicContext.startRendering(),
      );
      musicResult.pass &&= retained;
      rows.push(musicResult);
      const fullMix = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
      const fullOutput = createMixOutput(fullMix, fullMix.destination);
      const mixMusic = new MusicLoop(fullMix, fullOutput, samples.music!);
      mixMusic.setLevel(0.28, 0);
      mixMusic.setPlaying(true, 0);
      mixMusic.setPlaying(false, 1.2);
      for (let i = 0; i < 8; i++) {
        const voice = new VehicleVoice(fullMix, fullOutput, samples, i);
        voice.set({ ...car, slot: i }, true, 0.7 / Math.sqrt(8), (i - 3.5) / 5);
        voice.set({ ...car, slot: i }, false, 0.7 / Math.sqrt(8), (i - 3.5) / 5, 1.2);
      }
      for (let i = 0; i < 8; i++)
        renderEffect(fullMix, fullOutput, 'explosion', 0.04 * i, 0.65, (i - 3.5) / 5, samples);
      rows.push(measure('eight cars + music + sampled explosions', await fullMix.startRendering()));

      const crossing = (b: AudioBuffer) => {
        const d = b.getChannelData(0);
        let n = 0;
        for (let i = sampleRate * 0.25; i < sampleRate * 0.75; i++)
          if (d[i - 1] < 0 && d[i] >= 0) n++;
        return n;
      };
      const pitchPass = crossing(engineBuffers[1]) > crossing(engineBuffers[0]) * 1.1;
      const passed = rows.filter((r) => r.pass).length + Number(stereoPass) + Number(pitchPass),
        total = rows.length + 2;
      document.querySelector('#audio-rows')!.innerHTML =
        rows
          .map(
            (r) =>
              `<tr><td>${r.effect}</td><td>${r.peak.toFixed(4)}</td><td>${r.rms.toFixed(4)}</td><td>${r.tail.toFixed(6)}</td><td>${r.pass ? 'PASS' : 'FAIL'}</td></tr>`,
          )
          .join('') +
        `<tr><td>Stereo left/right</td><td colspan="3">${(energy(0) / energy(1)).toFixed(2)}×</td><td>${stereoPass ? 'PASS' : 'FAIL'}</td></tr>`;
      const report = {
        ok: passed === total,
        passed,
        total,
        sampleRate,
        rows,
        stereoPass,
        pitchPass,
      };
      document
        .querySelector('#audio-rows')!
        .insertAdjacentHTML(
          'beforeend',
          `<tr><td>Nitro raises engine pitch</td><td colspan="3">${crossing(engineBuffers[0])} → ${crossing(engineBuffers[1])} crossings</td><td>${pitchPass ? 'PASS' : 'FAIL'}</td></tr>`,
        );
      document.querySelector('#audio-report')!.textContent = JSON.stringify(report, null, 2);
      status.textContent = `${passed}/${total} sprawdzeń dźwięku ${passed === total ? 'PASS' : 'FAIL'}. Próbka zawiera efekty i dwa nagrania silnika. Muzyka i poślizg sprawdzone osobno.`;
      const url = URL.createObjectURL(
          new Blob([wav([...buffers, ...engineBuffers])], {
            type: 'audio/wav',
          }),
        ),
        sample = document.querySelector<HTMLAudioElement>('#audio-sample')!,
        download = document.querySelector<HTMLAnchorElement>('#audio-download')!;
      sample.src = url;
      sample.hidden = false;
      download.href = url;
      download.hidden = false;
      const canvas = document.querySelector<HTMLCanvasElement>('#audio-wave')!,
        ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#172536';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#ffc34a';
      ctx.beginPath();
      for (let x = 0; x < 960; x++) {
        const f = (x / 960) * buffers.length,
          index = Math.min(buffers.length - 1, Math.floor(f)),
          data = buffers[index].getChannelData(0),
          y = 65 - data[Math.floor((f - index) * (data.length - 1))] * 180;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      setTimeout(() => void live.close(), Math.ceil((when - live.currentTime + 2) * 1000));
    } catch (error) {
      status.textContent = 'FAIL: ' + (error as Error).message;
    } finally {
      button.disabled = false;
    }
  };
}
