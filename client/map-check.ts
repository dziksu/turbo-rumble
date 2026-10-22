// Development-only surface inspection using the production scene and fixed camera positions.
import { Vector3 } from 'three';
import { GameScene } from './scene.ts';
import { getTrack } from '../shared/track.ts';
import { MAPS, type MapId } from '../shared/maps.ts';

export async function mountMapCheck(app: HTMLElement) {
  const query = new URLSearchParams(location.search);
  const mapId = Object.hasOwn(MAPS, query.get('map') ?? '')
    ? (query.get('map') as MapId)
    : 'desert';
  const { OBSTACLES, OVERVIEW_CENTER, OVERVIEW_RADIUS, RAMPS, TRACK_LENGTH, cameraPose, trackAt } =
    getTrack(mapId);
  document.body.className = 'map-check';
  app.innerHTML = /* HTML */ `<style>
      .map-check {
        background: #142633;
        color: #fff6df;
        overflow: hidden;
      }
      .map-check header {
        height: 112px;
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
      .map-check #map-world {
        height: calc(100svh - 112px);
      }
    </style>
    <header>
      <div>
        <h1>Turbo Rumble · kontrola powierzchni</h1>
        <p id="map-status">Ładowanie sceny…</p>
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
      ><button id="map-scorch">Dodaj ślad wybuchu</button
      ><button id="map-clear">Wyczyść ślady</button>
    </header>
    <main id="map-world"></main>`;
  const scene = new GameScene(document.querySelector('#map-world')!, () => {}, mapId);
  const biome = document.querySelector<HTMLSelectElement>('#map-biome')!;
  for (const [id, map] of Object.entries(MAPS)) biome.add(new Option(map.name, id));
  biome.value = mapId;
  biome.onchange = () => {
    location.href = `/map-check?map=${biome.value}&s=0&view=overview`;
  };
  scene.scene.fog = null;
  const locations = document.querySelector<HTMLSelectElement>('#map-location')!,
    view = document.querySelector<HTMLSelectElement>('#map-view')!,
    position = document.querySelector<HTMLInputElement>('#map-position')!;
  const points: [string, number][] = [
    ['Start / meta', 0],
    ['Prosta', 80],
    ...(getTrack(mapId).desert
      ? ([
          ['Rynek i fontanna', TRACK_LENGTH * 0.087],
          ['Plac serwisowy', TRACK_LENGTH * 0.52],
          ...getTrack(mapId).desert!.bridges.map(
            (bridge) => [bridge.name, bridge.s] as [string, number],
          ),
        ] as [string, number][])
      : []),
    ...(getTrack(mapId).biome?.landmarks.map(
      (point) => [point.name, point.s] as [string, number],
    ) ?? []),
    ...getTrack(mapId).GAPS.map(
      (gap, i) =>
        [`${gap.kind === 'river' ? 'Rzeka' : 'Lawa'} ${i + 1}`, gap.s] as [string, number],
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
  view.value = ['chase', 'left', 'right', 'overview'].includes(query.get('view') ?? '')
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
          new Vector3(OVERVIEW_RADIUS * 0.8, OVERVIEW_RADIUS * 1.8, OVERVIEW_RADIUS),
        ),
        target: OVERVIEW_CENTER.clone(),
      };
    else if (mode === 'chase') scene.inspectionPose = cameraPose(s);
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
    history.replaceState(null, '', `/map-check?map=${mapId}&s=${s.toFixed(1)}&view=${mode}`);
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
  await scene.ready;
  document.querySelector('#map-status')!.textContent =
    'Gotowe · stała kamera, prawdziwa geometria i materiały gry';
  window.addEventListener('pagehide', () => scene.destroy(), { once: true });
}
