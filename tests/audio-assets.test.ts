import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AUDIO_FILES } from '../client/audio-assets.ts';
import { engineDrive, tyreSlip } from '../client/vehicle-audio.ts';

test('tyre squeal follows real slip and contact rather than steering intent', () => {
  const drift = { alive: true, grounded: true, speed: 19, slip: 0.5 };
  assert.ok(tyreSlip(drift) > 0.7);
  assert.equal(tyreSlip({ ...drift, slip: -0.5 }), tyreSlip(drift));
  for (const change of [
    { alive: false },
    { grounded: false },
    { grounded: undefined },
    { speed: 0 },
    { speed: 4 },
    { slip: 0 },
    { slip: 0.08 },
  ])
    assert.equal(tyreSlip({ ...drift, ...change }), 0);
  assert.ok(tyreSlip({ ...drift, slip: 0.2 }) < tyreSlip(drift));
});

test('engine has bounded revs, audible gear changes and a separate nitro pitch rise', () => {
  for (let speed = 0; speed < 100; speed += 0.2) {
    const normal = engineDrive(speed),
      nitro = engineDrive(speed, true);
    assert.ok(Number.isFinite(normal.rate) && normal.rate >= 0.8 && normal.rate < 2);
    assert.ok(nitro.rate > normal.rate * 1.1);
    assert.ok(normal.bass >= 38 && normal.cutoff <= 3330);
  }
  assert.ok(engineDrive(9.9).rate > engineDrive(10.1).rate);
  assert.ok(engineDrive(15).rate > engineDrive(12).rate);
});

test('shipped recordings are nonempty PCM and continuous loops have no added silent gap', async () => {
  for (const file of Object.values(AUDIO_FILES).flat()) {
    const data = await readFile(new URL('../public/assets/audio/' + file, import.meta.url));
    assert.ok(data.length > 1000, file);
    if (!file.endsWith('.wav')) continue;
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 12), 'WAVE');
    let offset = 12,
      pcm: Buffer | undefined;
    while (offset + 8 < data.length) {
      const length = data.readUInt32LE(offset + 4);
      if (data.toString('ascii', offset, offset + 4) === 'data') {
        pcm = data.subarray(offset + 8, offset + 8 + length);
        break;
      }
      offset += 8 + length + (length % 2);
    }
    assert.ok(pcm && pcm.length > 3000, file);
    if (file === 'engine.wav' || file === 'tire-skid.wav') {
      const window = 320,
        edgeRms = (start: number) => {
          let square = 0;
          for (let i = 0; i < window; i++)
            square += (pcm!.readInt16LE((start + i) * 2) / 32768) ** 2;
          return Math.sqrt(square / window);
        };
      assert.ok(
        edgeRms(0) > 0.025 && edgeRms(pcm.length / 2 - window) > 0.025,
        file + ' loops without silence',
      );
    }
  }
  const sources = await readFile(
    new URL('../public/assets/audio/SOURCE.md', import.meta.url),
    'utf8',
  );
  assert.match(sources, /audible-edge \(Tom Haigh\)/);
  assert.match(sources, /CC BY 3.0/);
  assert.match(sources, /Zane Little/);
});
