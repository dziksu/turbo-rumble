// Development-only, reproducible driving/effects lab using the real simulation and renderer.
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { vehicleScenario, type VehicleScenario } from './vehicle-scenarios.ts';
import { DEFAULT_SETTINGS, type MapId } from '../shared/maps.ts';
import { GameScene } from './scene.ts';
export async function mountHandlingCheck(app: HTMLElement) {
  document.body.className = 'handling-check';
  app.innerHTML = `<style>.handling-check #app{height:100svh;display:flex;flex-direction:column}.handling-check{background:#132331;color:#fff6df;overflow:hidden}.lab-top{min-height:96px;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:20px}.lab-top h1{font-size:19px;margin:0 0 5px}.lab-top p{font-size:11px;margin:0;color:#b5c6c7}.lab-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.lab-tools select{border:0;border-radius:8px;padding:10px;background:#294557;color:#fff6df}.lab-tools button,.lab-controls button{border:0;border-radius:10px;background:#ffc34a;color:#142637;font:700 13px 'Space Grotesk',sans-serif;padding:14px 20px;touch-action:none;user-select:none}.lab-controls{height:86px;flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:16px}.lab-controls button{background:#294557;color:#fff4d9;min-width:150px}.lab-controls button:active{background:#527c8c}.lab-world{position:relative;flex:1;min-height:0}.lab-readout{position:absolute;top:16px;left:20px;background:#142635e8;border-radius:10px;padding:12px 16px;font:11px/1.7 monospace;white-space:pre;pointer-events:none}</style><header class="lab-top"><div><h1>Turbo Rumble · próba jazdy</h1><p id="lab-status">Ładowanie fizyki i samochodów…</p></div><div class="lab-tools"><button id="lab-reset">Reset</button><button id="lab-blast">Wybuch</button><button id="lab-destroy">Zniszcz auto</button><button id="lab-close">Zbliżenie</button><button id="lab-heat">Ogień nitro</button><button id="lab-rocket">Rakieta 28 m</button><button id="lab-frost">Lód 24 m</button><button id="lab-pulse">Impuls</button><button id="lab-freeze-hit">Zamrożone auto</button><label>Model <select id="lab-model"><option value="0">Race</option><option value="1">Future</option><option value="2">Hatchback</option><option value="3">SUV</option></select></label><label>Koła <select id="lab-steer"><option value="0">Prosto</option><option value="1">Lewo</option><option value="-1">Prawo</option></select></label><label>Trasa <select id="lab-map"><option value="desert">Desert</option><option value="forest">Forest</option><option value="volcano">Volcano</option></select></label><button id="lab-jump">Skok ×8</button><button id="lab-land">Lądowanie ×8</button><button id="lab-crash">Zderzenie ×8</button><button id="lab-pause">Wznów jazdę</button></div></header><main class="lab-world"><div id="lab-world" style="position:absolute;inset:0"></div><output class="lab-readout" id="lab-metrics"></output></main><footer class="lab-controls"><button id="lab-left">← LEWO / A</button><button id="lab-brake">HAMULEC / COFANIE / ↓</button><button id="lab-right">PRAWO / D →</button></footer>`;
  await initPhysics();
  const mapSelect = document.querySelector<HTMLSelectElement>('#lab-map')!,
    modelSelect = document.querySelector<HTMLSelectElement>('#lab-model')!;
  const createRace = () => {
    const next = new Race(97, { ...DEFAULT_SETTINGS, mapId: mapSelect.value as MapId });
    for (let i = 0; i < 2; i++)
      next.addDriver({
        id: 'lab' + i,
        name: i ? 'Partner' : 'Test jazdy',
        slot: i ? 4 : Number(modelSelect.value),
        bot: false,
        ready: true,
        connected: true,
        wins: 0,
      });
    return next;
  };
  let race = createRace();
  const scene = new GameScene(document.querySelector('#lab-world')!, () => {}, race.track.id);
  let left = false,
    right = false,
    seq = 0,
    paused = true,
    peakShake = 0,
    peakDrift = 0,
    peakSlip = 0,
    closeUp = false,
    frontView = false;
  let shotStart: Vector3 | undefined,
    shotId = 0,
    shotEvent = 0,
    flightDistance = 0;
  const held = new Set<string>(),
    keys = new AbortController();
  const reset = (progress = 80) => {
    race.start();
    race.phase = 'racing';
    race.roundStart = race.tick;
    race.cameraProgress = progress;
    for (const [i, c] of [...race.cars.values()].entries()) {
      const s = progress + i * 22,
        a = race.track.trackAt(s),
        p = a.p.clone().addScaledVector(a.n, i === 0 ? -3 : 3);
      c.progress = s;
      c.weapon = null;
      c.invulnerableUntil = 100000;
      c.body.setTranslation({ x: p.x, y: 0.55, z: p.z }, true);
      c.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw), true);
      c.body.setLinvel(a.t.clone().multiplyScalar(16), true);
    }
    race.world.step();
    race.pause();
    paused = true;
    left = right = false;
    shotStart = undefined;
    flightDistance = 0;
    frontView = false;
    document.querySelector<HTMLSelectElement>('#lab-steer')!.value = '0';
    peakShake = 0;
    peakDrift = 0;
    peakSlip = 0;
    scene.roadEffects.clear();
    scene.shake.clear();
    race.cameraProgress = progress - 4;
    scene.cameraProgress = progress - 4;
    const pose = race.track.cameraPose(progress - 4);
    scene.cameraBase.copy(pose.position);
    scene.camera.position.copy(pose.position);
    scene.camera.lookAt(pose.target);
    scene.setState(race.snapshot('LAB'));
    document.querySelector('#lab-pause')!.textContent = 'Wznów jazdę';
  };
  const toggle = (p: boolean) => {
    paused = p;
    if (p) race.pause();
    else race.resume();
    document.querySelector('#lab-pause')!.textContent = p ? 'Wznów jazdę' : 'Pauza';
  };
  const updateCamera = () => {
    if (!closeUp) {
      scene.inspectionPose = null;
      return;
    }
    const car = race.cars.get('lab0')!,
      at = race.track.trackAt(car.progress),
      target = new Vector3().copy(car.body.translation()).add(new Vector3(0, 0.3, 0));
    scene.inspectionPose = {
      target,
      position: target
        .clone()
        .addScaledVector(at.n, 6)
        .addScaledVector(at.t, frontView ? 7 : -7)
        .add(new Vector3(0, 4, 0)),
    };
  };
  reset();
  await scene.ready;
  document.querySelector('#lab-status')!.textContent =
    `${race.track.id.toUpperCase()} · gotowy · przytrzymaj skręt, puść lub skontruj. Gaz automatyczny.`;
  const hold = (id: string, l: boolean, r: boolean) => {
    const el = document.querySelector<HTMLButtonElement>(id)!;
    el.onpointerdown = (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      left = l;
      right = r;
      toggle(false);
    };
    const release = () => {
      left = right = false;
    };
    el.onpointerup = release;
    el.onpointercancel = release;
    el.onlostpointercapture = release;
  };
  hold('#lab-left', true, false);
  hold('#lab-right', false, true);
  hold('#lab-brake', true, true);
  const scenario = (kind: VehicleScenario) => {
    race.dispose();
    const map = mapSelect.value as MapId;
    race = vehicleScenario(map, kind);
    seq = Math.max(...[...race.cars.values()].map((car) => car.input.seq));
    paused = true;
    left = right = closeUp = frontView = false;
    peakShake = peakDrift = peakSlip = 0;
    scene.inspectionPose = null;
    scene.roadEffects.clear();
    scene.shake.clear();
    scene.setState({ ...race.snapshot('LAB'), cars: [] });
    scene.cameraProgress = race.cameraProgress;
    const pose = race.track.cameraPose(race.cameraProgress);
    scene.cameraBase.copy(pose.position);
    scene.camera.position.copy(pose.position);
    scene.camera.lookAt(pose.target);
    scene.setState(race.snapshot('LAB'));
    document.querySelector('#lab-pause')!.textContent = 'Wznów jazdę';
    document.querySelector('#lab-status')!.textContent =
      `${map.toUpperCase()} · ${kind} · 8 aut · fizyczne zawieszenie Rapier`;
  };
  mapSelect.onchange = () => {
    race.dispose();
    race = createRace();
    held.clear();
    seq = 0;
    closeUp = frontView = false;
    scene.inspectionPose = null;
    // Switch geometry and remove old clones before reset positions the new camera/cars.
    scene.setState({ ...race.snapshot('LAB'), cars: [] });
    reset();
    document.querySelector('#lab-status')!.textContent =
      `${race.track.id.toUpperCase()} · gotowy · przytrzymaj skręt, puść lub skontruj. Gaz automatyczny.`;
  };
  document.querySelector<HTMLButtonElement>('#lab-jump')!.onclick = () => scenario('jump');
  document.querySelector<HTMLButtonElement>('#lab-land')!.onclick = () => scenario('landing');
  document.querySelector<HTMLButtonElement>('#lab-crash')!.onclick = () => scenario('collision');
  document.querySelector<HTMLButtonElement>('#lab-reset')!.onclick = () => reset();
  document.querySelector<HTMLButtonElement>('#lab-pause')!.onclick = () => toggle(!paused);
  document.querySelector<HTMLButtonElement>('#lab-blast')!.onclick = () => {
    toggle(false);
    const a = race.track.trackAt(race.cars.get('lab0')!.progress + 8);
    race.blast({ x: a.p.x, y: 0.6, z: a.p.z }, 'rocket');
    scene.setState(race.snapshot('LAB'));
  };
  document.querySelector<HTMLButtonElement>('#lab-destroy')!.onclick = () => {
    const car = race.cars.get('lab0')!;
    if (!car.alive) return;
    toggle(false);
    car.invulnerableUntil = 0;
    const at = race.track.trackAt(car.progress),
      origin = new Vector3().copy(car.body.translation()).addScaledVector(at.n, -1);
    race.blast(origin, 'rocket');
    race.step();
    toggle(true);
    scene.setState(race.snapshot('LAB'));
  };
  document.querySelector<HTMLButtonElement>('#lab-heat')!.onclick = () => {
    reset();
    const at = race.track.trackAt(80),
      owner = race.cars.get('lab0')!,
      target = race.cars.get('lab1')!;
    for (const [index, car] of [owner, target].entries()) {
      const position = at.p.clone().addScaledVector(at.t, index ? -3.6 : 0);
      position.y = 0.6;
      car.body.setTranslation(position, true);
      car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      car.progress = 80 - (index ? 3.6 : 0);
      car.invulnerableUntil = 0;
    }
    toggle(false);
    owner.weapon = 'boost';
    race.useWeapon(owner);
    race.step();
    toggle(true);
    closeUp = true;
    updateCamera();
    scene.setState(race.snapshot('LAB'));
    document.querySelector('#lab-status')!.textContent =
      'NITRO · krótki płomień z tyłu. Partner w strumieniu: spalony wrak.';
  };
  for (const kind of ['rocket', 'frost', 'pulse'] as const)
    document.querySelector<HTMLButtonElement>(`#lab-${kind}`)!.onclick = () => {
      reset(20);
      const source = race.cars.get('lab0')!;
      if (kind === 'pulse') {
        const target = race.cars.get('lab1')!,
          at = race.track.trackAt(source.progress);
        const position = new Vector3().copy(source.body.translation()).addScaledVector(at.n, 4);
        target.body.setTranslation(position, true);
        target.progress = source.progress;
      }
      toggle(false);
      source.weapon = kind;
      shotEvent = race.nextEvent;
      race.useWeapon(source);
      const shot = race.shots.at(-1);
      if (shot) {
        shotStart = new Vector3().copy(shot.position);
        shotId = shot.id;
      }
      document.querySelector('#lab-status')!.textContent =
        kind === 'pulse'
          ? 'IMPULS · silne odepchnięcie rywala, bez bezpośredniej eliminacji.'
          : `${kind === 'rocket' ? 'RAKIETA · 28 m' : 'LÓD · 24 m'} · wybuch na końcu zasięgu, bez obrażeń własną rakietą.`;
    };
  document.querySelector<HTMLButtonElement>('#lab-freeze-hit')!.onclick = () => {
    reset(60);
    const target = race.cars.get('lab0')!,
      source = race.cars.get('lab1')!;
    const at = race.track.trackAt(target.progress),
      position = new Vector3().copy(target.body.translation());
    source.body.setTranslation(position.clone().addScaledVector(at.t, -8), true);
    source.body.setRotation(target.body.rotation(), true);
    source.body.setLinvel(at.t.clone().multiplyScalar(16), true);
    source.progress = target.progress - 8;
    source.invulnerableUntil = target.invulnerableUntil = 0;
    race.world.step();
    toggle(false);
    source.weapon = 'frost';
    race.useWeapon(source);
    for (let i = 0; i < 60 && target.frostUntil <= race.tick; i++) race.step();
    for (let i = 0; i < 5; i++) {
      race.input(target.id, { seq: ++seq, left: true, right: false, actionSeq: 0 });
      race.step();
    }
    toggle(true);
    closeUp = true;
    updateCamera();
    scene.setState(race.snapshot('LAB'));
    document.querySelector('#lab-status')!.textContent =
      `MRÓZ · trafienie prawdziwym pociskiem · prędkość celu ${(target.frostSpeed! * 3.6).toFixed(1)} km/h · skręt ${target.steering.toFixed(2)} · pauza do inspekcji`;
  };
  document.querySelector<HTMLButtonElement>('#lab-close')!.onclick = () => {
    closeUp = !closeUp;
    updateCamera();
  };
  document.querySelector<HTMLSelectElement>('#lab-model')!.onchange = (event) => {
    race.cars.get('lab0')!.slot = Number((event.currentTarget as HTMLSelectElement).value);
    // Recreate the clone when selecting another source model, using normal scene cleanup.
    scene.setState({ ...race.snapshot('LAB'), cars: [] });
    reset();
  };
  document.querySelector<HTMLSelectElement>('#lab-steer')!.onchange = (event) => {
    const direction = Number((event.currentTarget as HTMLSelectElement).value);
    reset();
    document.querySelector<HTMLSelectElement>('#lab-steer')!.value = String(direction);
    if (direction) {
      toggle(false);
      for (let i = 0; i < 8; i++) {
        race.input('lab0', { seq: ++seq, left: direction > 0, right: direction < 0, actionSeq: 0 });
        race.step();
      }
      toggle(true);
    }
    closeUp = frontView = true;
    updateCamera();
    scene.setState(race.snapshot('LAB'));
  };
  const timer = setInterval(() => {
    if (!paused) {
      for (const c of race.cars.values())
        race.input(c.id, {
          seq: ++seq,
          left: c.id === 'lab0' && left,
          right: c.id === 'lab0' && right,
          actionSeq: 0,
        });
      race.step();
      race.cameraProgress = race.cars.get('lab0')!.progress - 4;
      const telemetry = race.snapshot('LAB').cars[0];
      peakDrift = Math.max(peakDrift, telemetry.drift ?? 0);
      peakSlip = Math.max(peakSlip, Math.abs(telemetry.slip ?? 0));
      scene.setState(race.snapshot('LAB'));
    }
    if (shotStart) {
      const position =
        race.shots.find((shot) => shot.id === shotId)?.position ??
        race.events.find(
          (event) =>
            event.id >= shotEvent && (event.type === 'explosion' || event.type === 'frost'),
        )?.position;
      if (position) flightDistance = new Vector3().copy(position).distanceTo(shotStart);
    }
    updateCamera();
    peakShake = Math.max(peakShake, scene.camera.position.distanceTo(scene.cameraBase));
    const c = race.snapshot('LAB').cars[0],
      wheels = scene.cars.get('lab0')?.wheels;
    document.querySelector('#lab-metrics')!.textContent =
      `Bieg: ${race.cars.get('lab0')!.reversing ? 'WSTECZNY' : 'DO PRZODU'}\nLot pocisku: ${flightDistance.toFixed(1)} m · Aktywne pociski: ${race.shots.filter((shot) => shot.kind !== 'mine').length}\nNitro: ${c.boosted ? 'AKTYWNE' : 'WYŁĄCZONE'} · Partner: ${race.snapshot('LAB').cars[1]?.wrecked ? 'SPALONY' : 'SPRAWNY'}\nMróz: ${c.frozen ? 'ZAMROŻONY · skręt zablokowany' : 'NIEAKTYWNY'}\nStan: ${c.wrecked ? 'SPALONY WRAK · bez kół' : c.alive ? 'AUTO SPRAWNE' : 'WYELIMINOWANY'}\nPrędkość: ${(c.speed * 3.6).toFixed(1)} km/h   Skręt: ${(c.steering ?? 0).toFixed(0)}\nDrift: ${((c.drift ?? 0) * 100).toFixed(0)}% (maks. ${(peakDrift * 100).toFixed(0)}%)   Kąt poślizgu: ${(((c.slip ?? 0) * 180) / Math.PI).toFixed(1)}° (maks. ${((peakSlip * 180) / Math.PI).toFixed(1)}°)\nKontakt: ${race.cars.get('lab0')!.vehicle.contacts}/4 · Zawieszenie [mm]: ${(c.suspension ?? []).map((value) => (value * 1000).toFixed(0)).join(' / ')}\nKoła: ${wheels?.road.length ?? 0} jezdne / ${(wheels?.all.length ?? 0) - (wheels?.road.length ?? 0)} zapasowe\nPrzypalenia: ${scene.roadEffects.scorchCount}   Ślady opon: ${scene.roadEffects.segments.filter(Boolean).length}\nSzczyt drgania kamery: ${peakShake.toFixed(3)} m`;
  }, 20);
  const syncKeys = () => {
    left = held.has('KeyA') || held.has('ArrowLeft') || held.has('ArrowDown');
    right = held.has('KeyD') || held.has('ArrowRight') || held.has('ArrowDown');
  };
  window.addEventListener(
    'keydown',
    (e) => {
      if (!['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowDown'].includes(e.code)) return;
      e.preventDefault();
      held.add(e.code);
      syncKeys();
      toggle(false);
    },
    { signal: keys.signal },
  );
  window.addEventListener(
    'keyup',
    (e) => {
      held.delete(e.code);
      syncKeys();
    },
    { signal: keys.signal },
  );
  window.addEventListener(
    'blur',
    () => {
      held.clear();
      left = right = false;
      toggle(true);
    },
    { signal: keys.signal },
  );
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(timer);
      keys.abort();
      scene.destroy();
      race.dispose();
    },
    { once: true },
  );
}
