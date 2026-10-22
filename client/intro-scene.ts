import { CarWheels } from './car-wheels.ts';
import { t, onLanguageChange } from './i18n.ts';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { disposeResources } from './resources.ts';
import { introPose } from './intro-motion.ts';

interface Actor {
  group: T.Group;
  wheels: CarWheels;
}
const standard = (color: T.ColorRepresentation, roughness = 0.75) =>
  new T.MeshStandardMaterial({ color, roughness });

/** Menu-only choreography. It neither creates a race nor connects a controller. */
export class IntroScene {
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(36, 1, 0.3, 100);
  private readonly renderer: T.WebGLRenderer;
  private readonly actors: Actor[] = [];
  private readonly sources: T.Object3D[] = [];
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly abort = new AbortController();
  private readonly stopLanguage: () => void;
  private elapsed = 0;
  private lastTime = 0;
  private raf = 0;
  private paused = false;
  private visible = true;
  private disposed = false;
  readonly ready: Promise<void>;

  constructor(
    private readonly container: HTMLElement,
    private readonly toggle: HTMLButtonElement,
  ) {
    this.renderer = new T.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    this.scene.add(new T.HemisphereLight('#fff4dd', '#b17e63', 2.4));
    const sun = new T.DirectionalLight('#fff2d8', 3.4);
    sun.position.set(-7, 14, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    const rim = new T.DirectionalLight('#afe8ed', 2.2);
    rim.position.set(4, 5, -10);
    this.scene.add(rim);
    this.buildStage();
    this.toggle.onclick = () => {
      this.paused = !this.paused;
      this.refresh();
    };
    document.addEventListener('visibilitychange', this.refresh, { signal: this.abort.signal });
    this.reducedMotion.addEventListener('change', this.refresh, { signal: this.abort.signal });
    window.addEventListener('pagehide', () => this.destroy(), {
      once: true,
      signal: this.abort.signal,
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.refresh();
    });
    this.intersectionObserver.observe(container);
    this.ready = this.loadCars().then(() => {
      if (!this.disposed) {
        container.dataset.ready = 'true';
        this.refresh();
      }
    });
    this.stopLanguage = onLanguageChange(this.refresh);
    this.resize();
    this.refresh();
  }

  private buildStage() {
    const platform = new T.Mesh(new T.CylinderGeometry(6.2, 6.35, 0.45, 64), standard('#39474c'));
    platform.position.y = -0.225;
    platform.scale.z = 0.72;
    platform.receiveShadow = true;
    this.scene.add(platform);
    const edge = new T.Mesh(new T.TorusGeometry(5.5, 0.035, 5, 80), standard('#e8d7b0'));
    edge.rotation.x = Math.PI / 2;
    edge.scale.y = 0.72;
    edge.position.y = 0.012;
    this.scene.add(edge);
    for (let i = 0; i < 18; i++) {
      const angle = (i * Math.PI) / 9,
        line = new T.Mesh(
          new T.BoxGeometry(0.12, 0.025, 0.5),
          standard(i % 3 ? '#e9d6b2' : '#f5b83c'),
        );
      line.position.set(Math.sin(angle) * 4.65, 0.025, Math.cos(angle) * 3.2);
      line.rotation.y = angle;
      this.scene.add(line);
    }
    const ramp = new T.Mesh(new T.BoxGeometry(3.1, 0.22, 3.4), standard('#f4b43d'));
    ramp.position.set(0, 0.43, -0.8);
    ramp.rotation.x = -0.25;
    ramp.castShadow = ramp.receiveShadow = true;
    this.scene.add(ramp);
    for (const side of [-1, 1]) {
      const rail = new T.Mesh(new T.BoxGeometry(0.09, 0.08, 3.4), standard('#f8e6bd'));
      rail.position.set(side * 1.42, 0.17, 0);
      ramp.add(rail);
    }
  }

  private async loadCars() {
    const loader = new GLTFLoader();
    const vehicles = await Promise.all(
      ['race', 'hatchback-sports', 'race-future'].map(async (name) => {
        try {
          const gltf = await loader.loadAsync(`/assets/cars/${name}.glb`);
          return gltf.scene;
        } catch {
          const fallback = new T.Group();
          fallback.add(new T.Mesh(new T.BoxGeometry(1.7, 0.7, 3.4), standard('#c2d1df')));
          return fallback;
        }
      }),
    );
    if (this.disposed) {
      disposeResources(vehicles);
      return;
    }
    for (const source of vehicles) {
      this.sources.push(source);
      const group = new T.Group(),
        vehicle = clone(source);
      const bounds = new T.Box3().setFromObject(vehicle),
        size = bounds.getSize(new T.Vector3());
      vehicle.scale.setScalar(3.8 / Math.max(size.x, size.z));
      const scaled = new T.Box3().setFromObject(vehicle),
        center = scaled.getCenter(new T.Vector3());
      vehicle.position.set(-center.x, -scaled.min.y, -center.z);
      vehicle.traverse((node) => {
        if (node instanceof T.Mesh) node.castShadow = node.receiveShadow = true;
      });
      group.add(vehicle);
      this.scene.add(group);
      this.actors.push({ group, wheels: new CarWheels(vehicle) });
    }
  }

  private resize() {
    const width = this.container.clientWidth,
      height = this.container.clientHeight;
    if (!width || !height || this.disposed) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }
  private render(dt = 0) {
    const time = this.reducedMotion.matches ? 0 : this.elapsed;
    for (const [index, actor] of this.actors.entries()) {
      const pose = introPose(time, index);
      actor.group.position.set(pose.x, pose.y, pose.z);
      actor.group.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
      actor.wheels.update(
        {
          position: actor.group.position,
          rotation: actor.group.quaternion,
          steering: 0,
          moving: !this.paused && !this.reducedMotion.matches,
          grounded: true,
        },
        dt,
      );
    }
    const angle = 0.62 + Math.sin((time * Math.PI) / 8) * 0.055,
      distance = this.camera.aspect < 1.15 ? 26 : 21.5;
    this.camera.position.set(Math.sin(angle) * distance, 10.2, Math.cos(angle) * distance);
    this.camera.lookAt(0, 0.3, 0);
    this.renderer.render(this.scene, this.camera);
  }
  private refresh = () => {
    if (this.disposed) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastTime = 0;
    const stopped = this.paused || this.reducedMotion.matches;
    this.toggle.setAttribute('aria-pressed', String(stopped));
    this.toggle.setAttribute('aria-label', stopped ? t('Wznów animację') : t('Wstrzymaj animację'));
    this.toggle.textContent = stopped ? '▶' : 'Ⅱ';
    this.toggle.hidden = this.reducedMotion.matches;
    if (!document.hidden && this.visible) {
      this.render();
      if (!stopped) this.raf = requestAnimationFrame(this.frame);
    }
  };
  private frame = (time: number) => {
    const dt = this.lastTime ? Math.min(0.05, (time - this.lastTime) / 1000) : 0;
    this.elapsed += dt;
    this.lastTime = time;
    this.render(dt);
    this.raf = requestAnimationFrame(this.frame);
  };
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.stopLanguage();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.toggle.onclick = null;
    disposeResources([this.scene, ...this.sources]);
    this.scene.traverse((object) => {
      if (object instanceof T.DirectionalLight) object.shadow.dispose();
    });
    this.scene.clear();
    this.actors.length = this.sources.length = 0;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.container.replaceChildren();
  }
}
