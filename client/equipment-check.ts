// Development-only inspection of real car clones and authoritative item snapshots.
import { Quaternion, Vector3 } from 'three';
import { GameScene } from './scene.ts';
import { Race, initPhysics } from '../shared/simulation.ts';
import { mountLanguageSwitch, onLanguageChange, weaponText } from './i18n.ts';
import { header } from './core/dom.ts';
import type { Weapon } from '../shared/types.ts';
export async function mountEquipmentCheck(app: HTMLElement) {
  document.body.className = 'equipment-check';
  app.innerHTML = `${header('<strong>Equipment studio</strong>')}<style>
  .equipment-check{background:#172536;color:#fff8e9;overflow:hidden}.equipment-check .topbar{height:68px;color:#172536}.equipment-stage{height:calc(100svh - 165px);position:relative}.equipment-stage>div{position:absolute;inset:0}.equipment-tools{height:97px;display:flex;gap:12px;padding:18px;align-items:center;justify-content:center;flex-wrap:wrap}.equipment-tools button,.equipment-tools select{padding:12px;border:0;border-radius:9px;font:700 12px 'Space Grotesk';background:#ffcd64;color:#172536}.equipment-tools output{font:12px monospace;min-width:180px}.equipment-tools label{font-size:12px}
  </style><main class="equipment-stage"><div id="equipment-world"></div></main><footer class="equipment-tools"><select id="equipment-focus" aria-label="Inspect item"><option value="all">All five items</option><option value="rocket">Rocket</option><option value="mine">Mine</option><option value="frost">Frost</option><option value="pulse">Pulse</option><option value="boost">Nitro</option></select><label>Car <select id="equipment-car"><option value="0">Race</option><option value="1">Future</option><option value="2">Hatchback</option><option value="3">SUV</option></select></label><button id="equipment-reset">Equip all</button><button id="equipment-use">Use selected item</button><button id="equipment-wreck">Wreck selected car</button><output id="equipment-readout">Loading…</output></footer>`;
  mountLanguageSwitch(app);
  await initPhysics();
  const scene = new GameScene(document.querySelector('#equipment-world')!),
    race = new Race(97),
    kinds: Weapon[] = ['rocket', 'mine', 'frost', 'pulse', 'boost'],
    focus = document.querySelector<HTMLSelectElement>('#equipment-focus')!,
    model = document.querySelector<HTMLSelectElement>('#equipment-car')!;
  for (const [i, kind] of kinds.entries())
    race.addDriver({
      id: kind,
      name: weaponText(kind).name,
      slot: i,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
  const update = () => {
    const snapshot = race.snapshot('STUDIO');
    for (const car of snapshot.cars) car.name = weaponText(car.id as Weapon).name;
    scene.setState(snapshot);
    const selected = focus.value === 'all' ? 'rocket' : (focus.value as Weapon);
    const at = race.track.trackAt(80),
      target =
        focus.value === 'all'
          ? at.p.clone().add(new Vector3(0, 1, 0))
          : new Vector3()
              .copy(race.cars.get(selected)!.body.translation())
              .add(new Vector3(0, 0.7, 0));
    scene.inspectionPose = {
      target,
      position: target
        .clone()
        .addScaledVector(at.n, focus.value === 'all' ? 8 : 5.2)
        .addScaledVector(at.t, focus.value === 'all' ? -13 : 5.8)
        .add(new Vector3(0, focus.value === 'all' ? 12 : 3.7, 0)),
    };
    for (const car of snapshot.cars) {
      const visual = scene.cars.get(car.id);
      if (visual) {
        visual.label.visible = focus.value === 'all';
        visual.group.visible = focus.value === 'all' || car.id === focus.value;
      }
    }
    const car = snapshot.cars.find((c) => c.id === selected)!;
    document.querySelector('#equipment-readout')!.textContent =
      `${focus.value === 'all' ? `${snapshot.cars.filter((c) => c.alive && c.weapon).length} / 5 items equipped` : `${weaponText(selected as Weapon).name}: ${car.alive && car.weapon ? 'mounted' : 'empty'}`} · ${scene.assetsReady ? '3D ready' : 'loading'}`;
  };
  const reset = () => {
    race.lobby();
    race.start();
    race.phase = 'racing';
    race.cameraProgress = 80;
    const at = race.track.trackAt(80);
    for (const [i, kind] of kinds.entries()) {
      const car = race.cars.get(kind)!,
        p = at.p.clone().addScaledVector(at.n, (i - 2) * 3.1);
      car.slot = focus.value === 'all' ? i : Number(model.value);
      car.weapon = kind;
      car.progress = 80;
      car.invulnerableUntil = 0;
      car.body.setTranslation({ x: p.x, y: 0.55, z: p.z }, true);
      car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    race.pause();
    scene.setState({ ...race.snapshot('STUDIO'), cars: [] });
    update();
  };
  await scene.ready;
  reset();
  focus.onchange = reset;
  model.onchange = reset;
  document.querySelector<HTMLButtonElement>('#equipment-reset')!.onclick = reset;
  document.querySelector<HTMLButtonElement>('#equipment-use')!.onclick = () => {
    race.resume();
    race.useWeapon(race.cars.get(focus.value === 'all' ? 'rocket' : focus.value)!);
    race.pause();
    update();
  };
  document.querySelector<HTMLButtonElement>('#equipment-wreck')!.onclick = () => {
    race.resume();
    const car = race.cars.get(focus.value === 'all' ? 'rocket' : focus.value)!;
    race.blast(car.body.translation(), 'rocket');
    race.step();
    race.pause();
    update();
  };
  const stopLanguage = onLanguageChange(reset);
  window.addEventListener(
    'pagehide',
    () => {
      stopLanguage();
      scene.destroy();
      race.world.free();
    },
    { once: true },
  );
}
