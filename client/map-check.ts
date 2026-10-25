import { syncPickupVisuals } from './pickup-visuals.ts';
// Development-only surface inspection using the production scene and fixed camera positions.
import { Vector3 } from 'three';
import { GameScene } from './scene.ts';
import { getTrack } from '../shared/track.ts';
import { createForestLayout } from './forest-layout.ts';
import { MAPS, type MapId } from '../shared/maps.ts';

export async function mountMapCheck(app: HTMLElement) {
  const query = new URLSearchParams(location.search);
  const capture = query.get('capture') === '1';
  const mapId = Object.hasOwn(MAPS, query.get('map') ?? '')
    ? (query.get('map') as MapId)
    : 'desert';
  const { OBSTACLES, OVERVIEW_CENTER, OVERVIEW_RADIUS, RAMPS, TRACK_LENGTH, cameraPose, trackAt } =
    getTrack(mapId);
  document.body.className = 'map-check';
  document.title = `${MAPS[mapId].name} · Map inspection`;
  app.innerHTML = /* HTML */ `<style>
      .map-check {
        background: #142633;
        color: #fff6df;
        overflow: hidden;
      }
      .map-check header {
        min-height: 112px;
        padding: 12px 20px;
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }
      .map-check h1 {
        font-size: 17px;
        margin: 0;
      }
      .map-check p {
        font-size: 11px;
        margin: 4px 0;
        color: #bdccce;
      }
      .map-check label {
        font-size: 11px;
        display: grid;
        gap: 5px;
      }
      .map-check select,
      .map-check button {
        font:
          600 12px 'Space Grotesk',
          sans-serif;
        border: 0;
        border-radius: 8px;
        padding: 9px;
        background: #ffca63;
        color: #142633;
      }
      .map-check input {
        width: 190px;
      }
      .map-check #app {
        height: 100svh;
        display: flex;
        flex-direction: column;
      }
      .map-check header {
        flex-shrink: 0;
      }
      .map-check #map-world {
        flex: 1;
        min-height: 0;
      }
      .map-check input[type='checkbox'] {
        width: auto;
      }
    </style>
    <header>
      <div>
        <h1>Turbo Rumble · kontrola powierzchni</h1>
        <p id="map-status">Ładowanie sceny…</p>
        <p id="map-performance"></p>
      </div>
      <label>MAPA<select id="map-biome"></select></label
      ><label>MIEJSCE<select id="map-location"></select></label
      ><label
        >WIDOK<select id="map-view">
          <option value="chase">Kamera wyścigu</option>
          <option value="left">Detal lewego pobocza</option>
          <option value="right">Detal prawego pobocza</option>
          <option value="overview">Cały tor</option>
        </select></label
      >
      <label
        >POZYCJA NA TORZE<input id="map-position" type="range" min="0" step="0.1" /><output
          id="map-distance"
        ></output></label
      ><label
        >AMBIENT<input id="map-ambient" type="range" min="0" max="200" value="100" /><output
          id="map-ambient-value"
          >100%</output
        ></label
      ><label>CIENIE<input id="map-shadows" type="checkbox" checked /></label
      ><button id="map-scorch">Dodaj ślad wybuchu</button
      ><button id="map-clear">Wyczyść ślady</button>
    </header>
    <main id="map-world"></main>`;
  if (capture) {
    const style = document.createElement('style');
    style.textContent =
      '.map-check header{display:none!important}.map-check #map-world{flex:none!important;width:100vw;height:56.25vw!important}.map-check #app{height:56.25vw!important}';
    document.head.append(style);
  }
  const scene = new GameScene(document.querySelector('#map-world')!, () => {}, mapId);
  const ambientIntensity = scene.lighting.ambient.intensity,
    hemisphereIntensity = scene.lighting.hemisphere.intensity;
  document.querySelector<HTMLInputElement>('#map-ambient')!.oninput = (event) => {
    const percent = Number((event.currentTarget as HTMLInputElement).value);
    scene.lighting.ambient.intensity = (ambientIntensity * percent) / 100;
    scene.lighting.hemisphere.intensity = (hemisphereIntensity * percent) / 100;
    document.querySelector('#map-ambient-value')!.textContent = `${percent}%`;
  };
  document.querySelector<HTMLInputElement>('#map-shadows')!.onchange = (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    scene.renderer.shadowMap.enabled = enabled;
    scene.lighting.sun.castShadow = enabled;
    scene.lighting.invalidate();
  };
  const biome = document.querySelector<HTMLSelectElement>('#map-biome')!;
  for (const [id, map] of Object.entries(MAPS)) biome.add(new Option(map.name, id));
  biome.value = mapId;
  biome.onchange = () => {
    location.href = `/map-check?map=${biome.value}&s=0&view=overview`;
  };
  if (mapId === 'desert') scene.scene.fog = null;
  scene.camera.far = 2200;
  scene.camera.updateProjectionMatrix();
  const locations = document.querySelector<HTMLSelectElement>('#map-location')!,
    view = document.querySelector<HTMLSelectElement>('#map-view')!,
    position = document.querySelector<HTMLInputElement>('#map-position')!;
  const woodland = mapId === 'forest' ? createForestLayout(getTrack(mapId)) : null;
  if (woodland) view.add(new Option('Polana / dzika przyroda', 'woodland'));
  if (mapId === 'volcano') {
    view.add(new Option('Krater / lawa', 'crater'));
    view.add(new Option('Wybrzeże / tropiki', 'coast'));
  }
  const points: [string, number][] = [
    ['Start / meta', 0],
    ['Prosta', 80],
    ...(getTrack(mapId).desert
      ? ([
          ...getTrack(mapId).desert!.landmarks.map(
            (point) => [point.name, point.s] as [string, number],
          ),
        ] as [string, number][])
      : []),
    ...(getTrack(mapId).biome?.landmarks.map(
      (point) => [point.name, point.s] as [string, number],
    ) ?? []),
    ...getTrack(mapId).GAPS.map(
      (gap, i) =>
        [
          `${gap.kind === 'river' ? 'Rzeka' : gap.kind === 'canyon' ? 'Wąwóz' : 'Lawa'} ${i + 1}`,
          gap.s,
        ] as [string, number],
    ),
    ...RAMPS.map((ramp, i) => [`Rampa ${i + 1}`, ramp.s] as [string, number]),
    ...OBSTACLES.filter((o) => o.kind === 'barrier').map(
      (obstacle, i) => [`Bariera ${i + 1}`, obstacle.s] as [string, number],
    ),
    ['Nawrót północny', TRACK_LENGTH * 0.58],
    ['Nawrót południowy', TRACK_LENGTH * 0.89],
  ];
  for (const [name, s] of points) {
    const option = document.createElement('option');
    option.textContent = name;
    option.value = String(s);
    locations.append(option);
  }
  const manual = document.createElement('option');
  manual.value = '';
  manual.textContent = 'Pozycja ręczna';
  manual.disabled = true;
  locations.append(manual);
  const initial = Number(query.get('s') ?? 80);
  position.max = String(TRACK_LENGTH);
  position.value = String(
    Number.isFinite(initial) ? Math.max(0, Math.min(TRACK_LENGTH, initial)) : 80,
  );
  view.value = [
    'chase',
    'left',
    'right',
    'overview',
    ...(woodland ? ['woodland'] : []),
    ...(mapId === 'volcano' ? ['crater', 'coast'] : []),
  ].includes(query.get('view') ?? '')
    ? query.get('view')!
    : 'chase';
  function updateView() {
    const s = Number(position.value),
      at = trackAt(s),
      mode = view.value;
    locations.value =
      [...locations.options].find(
        (option) => option.value !== '' && Math.abs(Number(option.value) - s) < 0.2,
      )?.value ?? '';
    if (mode === 'overview')
      scene.inspectionPose = {
        position: OVERVIEW_CENTER.clone().add(
          new Vector3(
            mapId === 'desert' ? 0 : OVERVIEW_RADIUS * 0.8,
            OVERVIEW_RADIUS * 1.85 * Math.max(1, 1.6 / scene.camera.aspect),
            OVERVIEW_RADIUS * 1.06 * Math.max(1, 1.6 / scene.camera.aspect),
          ),
        ),
        target: OVERVIEW_CENTER.clone(),
      };
    else if (mode === 'crater')
      scene.inspectionPose = {
        target: OVERVIEW_CENTER.clone().add(new Vector3(0, 30, 0)),
        position: OVERVIEW_CENTER.clone().add(new Vector3(68, 106, 100)),
      };
    else if (mode === 'coast') {
      const normal = at.p.clone().setY(0).normalize(),
        target = normal.clone().multiplyScalar(231);
      scene.inspectionPose = {
        target: target.clone().add(new Vector3(0, 2, 0)),
        position: target
          .clone()
          .addScaledVector(normal, 21)
          .addScaledVector(at.t, 8)
          .add(new Vector3(0, 12, 0)),
      };
    } else if (mode === 'woodland' && woodland?.clearings.length) {
      const center = woodland.clearings.reduce((nearest, p) =>
        p.distanceToSquared(at.p) < nearest.distanceToSquared(at.p) ? p : nearest,
      );
      scene.inspectionPose = {
        target: center.clone().add(new Vector3(0, 1, 0)),
        position: center.clone().add(new Vector3(12, 11, 14)),
      };
    } else if (mode === 'chase') scene.inspectionPose = cameraPose(s);
    else {
      const side = mode === 'left' ? 1 : -1,
        target = at.p.clone().addScaledVector(at.n, side * (at.width - 0.3));
      scene.inspectionPose = {
        target,
        position: target
          .clone()
          .addScaledVector(at.t, -6)
          .addScaledVector(at.n, side * 4)
          .add(new Vector3(0, 6, 0)),
      };
    }
    document.querySelector('#map-distance')!.textContent =
      `${s.toFixed(1)} / ${TRACK_LENGTH.toFixed(1)} m`;
    history.replaceState(
      null,
      '',
      `/map-check?map=${mapId}&s=${s.toFixed(1)}&view=${mode}${capture ? '&capture=1' : ''}`,
    );
  }
  locations.onchange = () => {
    position.value = locations.value;
    updateView();
  };
  view.onchange = updateView;
  position.oninput = updateView;
  document.querySelector<HTMLButtonElement>('#map-scorch')!.onclick = () => {
    const s = Number(position.value),
      ramp = RAMPS.find((ramp) => Math.abs(ramp.s - s) < ramp.length / 2),
      at = trackAt(s),
      p = at.p.addScaledVector(at.n, ramp?.side ?? 0);
    scene.roadEffects.addScorch(p, scene.roadEffects.scorchCount + 1);
  };
  document.querySelector<HTMLButtonElement>('#map-clear')!.onclick = () =>
    scene.roadEffects.clear();
  updateView();
  syncPickupVisuals(
    scene.scene,
    scene.pickups,
    getTrack(mapId).PICKUP_SPAWNS.map((p) => ({ ...p, active: true })),
  );
  await scene.ready;
  let previous = performance.now();
  const frameTimes: number[] = [];
  let meterFrame = 0;
  const meter = (now: number) => {
    frameTimes.push(now - previous);
    if (frameTimes.length > 120) frameTimes.shift();
    previous = now;
    meterFrame = requestAnimationFrame(meter);
  };
  meterFrame = requestAnimationFrame(meter);
  const meterTimer = window.setInterval(() => {
    const info = scene.renderer.info;
    const sorted = [...frameTimes].sort((a, b) => a - b);
    document.querySelector('#map-performance')!.textContent =
      `${info.render.calls} draw calls · ${info.render.triangles.toLocaleString('en-US')} triangles · frame p95 ${(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)} ms · ${info.memory.geometries} geometries`;
  }, 1000);
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(meterTimer);
      cancelAnimationFrame(meterFrame);
    },
    { once: true },
  );
  document.querySelector('#map-status')!.textContent =
    'Gotowe · stała kamera, prawdziwa geometria i materiały gry';
  window.addEventListener('pagehide', () => scene.destroy(), { once: true });
}
