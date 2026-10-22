import { toast } from './core/dom.ts';
import './audio-controls.css';
import type { Sound } from './audio.ts';
import { t } from './i18n.ts';

export function mountAudioControls(sound: Sound, soundButton: HTMLElement) {
  const settings = document.createElement('details');
  settings.className = 'audio-settings';
  settings.innerHTML = `<summary class="icon-button">MIX</summary><div class="audio-panel"><b class="audio-title"></b><label for="sound-volume" class="effects-label"></label><input id="sound-volume" type="range" min="0" max="100" /><div class="music-heading"><label for="music-volume"></label><button id="music-toggle" type="button" aria-pressed="false">♪</button></div><input id="music-volume" type="range" min="0" max="100" /><small>Pixel Sprinter · Zane Little</small></div>`;
  soundButton.after(settings);
  const volume = settings.querySelector<HTMLInputElement>('#sound-volume')!;
  const musicVolume = settings.querySelector<HTMLInputElement>('#music-volume')!;
  const musicToggle = settings.querySelector<HTMLButtonElement>('#music-toggle')!;
  const refresh = () => {
    soundButton.classList.toggle('enabled', !!sound.active);
    soundButton.setAttribute('aria-label', sound.active ? t('Wycisz dźwięk') : t('Włącz dźwięk'));
    soundButton.setAttribute('aria-pressed', String(!!sound.active));
    soundButton.dataset.audioState = sound.context?.state ?? 'locked';
    settings.querySelector('summary')!.setAttribute('aria-label', t('Ustawienia dźwięku'));
    settings.querySelector('.audio-title')!.textContent = t('Dźwięk i muzyka');
    settings.querySelector('.effects-label')!.textContent = t('Efekty i silniki');
    settings.querySelector('.music-heading label')!.textContent = t('Muzyka');
    volume.setAttribute('aria-label', t('Głośność efektów'));
    volume.title = t('Głośność efektów');
    musicVolume.setAttribute('aria-label', t('Głośność muzyki'));
    musicVolume.title = t('Głośność muzyki');
    musicToggle.setAttribute(
      'aria-label',
      sound.musicEnabled ? t('Wycisz muzykę') : t('Włącz muzykę'),
    );
    musicToggle.setAttribute('aria-pressed', String(sound.musicEnabled));
    musicToggle.classList.toggle('enabled', sound.musicEnabled);
    volume.value = String(Math.round(sound.volume * 100));
    musicVolume.value = String(Math.round(sound.musicVolume * 100));
  };
  sound.onChange = refresh;
  soundButton.onclick = async () => {
    try {
      await sound.toggle();
      if (sound.active) sound.play('ready');
    } catch {
      soundButton.dataset.audioState = 'unavailable';
      toast(
        'Przeglądarka nie udostępniła dźwięku. Spróbuj w aktualnym Chrome, Safari lub Firefox.',
      );
    }
  };
  volume.oninput = () => {
    sound.setVolume(Number(volume.value) / 100);
  };
  musicVolume.oninput = () => sound.setMusicVolume(Number(musicVolume.value) / 100);
  musicToggle.onclick = () => void sound.toggleMusic().catch(() => {});
  const unlock = () => {
    void sound.unlock().catch(() => {});
  };
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!(event.target as HTMLElement).closest('#sound-toggle, #music-toggle')) unlock();
      if (!settings.contains(event.target as Node)) settings.open = false;
    },
    { capture: true },
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && settings.open) {
      settings.open = false;
      settings.querySelector('summary')!.focus();
    }
    if (!event.repeat) unlock();
  });
  document.addEventListener('visibilitychange', () => sound.setHidden(document.hidden));
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) sound.setHidden(true);
    else sound.dispose();
  });
  window.addEventListener('pageshow', () => sound.setHidden(document.hidden));
  refresh();
  unlock();
  return { refresh };
}
