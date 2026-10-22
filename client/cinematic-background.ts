import { onLanguageChange, t } from './i18n.ts';

const scenes = [
  { image: '/assets/cinematics/desert.webp', name: 'SUNDOWN JUNCTION' },
  { image: '/assets/cinematics/forest.webp', name: 'TIMBER RUN' },
  { image: '/assets/cinematics/volcano.webp', name: 'ALOHA INFERNO' },
] as const;

export function mountCinematicBackground(root: HTMLElement) {
  const images = [...root.querySelectorAll<HTMLImageElement>('.cinema-image')];
  const dots = [...root.querySelectorAll<HTMLButtonElement>('[data-scene]')];
  const pause = root.querySelector<HTMLButtonElement>('#cinema-pause')!;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  let current = 0;
  let active = 0;
  let paused = false;
  let ticket = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    clearTimeout(timer);
    if (!paused && !motion.matches && !document.hidden && !events.signal.aborted)
      timer = setTimeout(() => void show((current + 1) % scenes.length), 9000);
  }
  function render() {
    root.querySelector('#scene-counter')!.textContent = `0${current + 1} / 03`;
    root.querySelector('#scene-name')!.textContent = scenes[current]!.name;
    dots.forEach((dot, index) => dot.setAttribute('aria-pressed', String(index === current)));
    pause.hidden = motion.matches;
    pause.textContent = paused ? '▶' : 'Ⅱ';
    pause.setAttribute('aria-pressed', String(paused));
    pause.setAttribute('aria-label', t(paused ? 'Wznów animację' : 'Wstrzymaj animację'));
  }
  async function show(index: number) {
    clearTimeout(timer);
    const request = ++ticket;
    if (index === current) return schedule();
    const image = new Image();
    image.src = scenes[index]!.image;
    try {
      await image.decode();
      if (request !== ticket || events.signal.aborted) return;
      const next = 1 - active;
      images[next]!.src = image.src;
      images[next]!.classList.add('is-active');
      images[active]!.classList.remove('is-active');
      active = next;
      current = index;
      render();
    } catch {
      // Keep the last loaded illustration if the next image is unavailable.
    } finally {
      if (request === ticket) schedule();
    }
  }
  dots.forEach((dot, index) =>
    dot.addEventListener('click', () => void show(index), { signal: events.signal }),
  );
  pause.addEventListener(
    'click',
    () => {
      paused = !paused;
      ticket++;
      render();
      schedule();
    },
    { signal: events.signal },
  );
  const refresh = () => {
    ticket++;
    render();
    schedule();
  };
  motion.addEventListener('change', refresh, { signal: events.signal });
  document.addEventListener('visibilitychange', refresh, { signal: events.signal });
  window.addEventListener('pageshow', refresh, { signal: events.signal });
  const stopLanguage = onLanguageChange(render);
  const dispose = () => {
    ticket++;
    clearTimeout(timer);
    stopLanguage();
    events.abort();
  };
  window.addEventListener(
    'pagehide',
    (event) => {
      ticket++;
      clearTimeout(timer);
      if (!event.persisted) dispose();
    },
    { signal: events.signal },
  );
  import.meta.hot?.dispose(dispose);
  render();
  schedule();
}
