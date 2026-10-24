import { ScreenAwake } from './screen-awake.ts';
import { onLanguageChange, t } from './i18n.ts';
import './screen-awake.css';

const STORAGE_KEY = 'turbo:screen-awake';

/** Automatically keep room screens awake; the button exposes actual state and an opt-out. */
export function mountScreenAwake(button: HTMLButtonElement) {
  let enabled = true;
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    /* Storage is optional. */
  }
  const screen = new ScreenAwake(
    window.isSecureContext && 'wakeLock' in navigator
      ? () => navigator.wakeLock.request('screen')
      : undefined,
    enabled,
    document.visibilityState === 'visible',
  );
  const refresh = () => {
    const status = screen.status;
    const label =
      status === 'active'
        ? t('Ekran pozostaje włączony')
        : status === 'unsupported'
          ? t('Ochrona przed wygaszaniem wymaga HTTPS i obsługiwanej przeglądarki.')
          : status === 'off'
            ? t('Wygaszanie ekranu dozwolone')
            : status === 'blocked'
              ? t('Przeglądarka nie utrzymuje ekranu włączonego. Kliknij, aby ponowić.')
              : t('Oczekiwanie na utrzymanie ekranu włączonego');
    button.dataset.screenAwake = status;
    button.disabled = status === 'unsupported';
    button.setAttribute('aria-pressed', String(status === 'active'));
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = status === 'active' ? '☀' : '☾';
  };
  screen.onChange = refresh;
  button.onclick = () => {
    if (screen.status === 'blocked') void screen.refresh();
    else {
      const enabled = !screen.wanted;
      try {
        localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
      } catch {
        /* Optional. */
      }
      void screen.setEnabled(enabled);
    }
  };
  const events = new AbortController();
  document.addEventListener(
    'visibilitychange',
    () => {
      void screen.setVisible(document.visibilityState === 'visible');
    },
    { signal: events.signal },
  );
  // Some browsers only permit the initial request after an interaction.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target !== button) void screen.refresh();
    },
    {
      once: true,
      signal: events.signal,
    },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.target !== button) void screen.refresh();
    },
    {
      once: true,
      signal: events.signal,
    },
  );
  window.addEventListener(
    'pageshow',
    () => {
      void screen.setVisible(document.visibilityState === 'visible');
    },
    { signal: events.signal },
  );
  const unsubscribe = onLanguageChange(refresh);
  window.addEventListener(
    'pagehide',
    (event) => {
      if (event.persisted) void screen.setVisible(false);
      else {
        events.abort();
        unsubscribe();
        screen.dispose();
      }
    },
    { signal: events.signal },
  );
  refresh();
  void screen.refresh();
  return screen;
}
