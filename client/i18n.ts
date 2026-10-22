import {
  EN,
  parseLanguage,
  translate,
  type Language,
  type Message,
  type Values,
} from './i18n/messages.ts';
import type { Snapshot, Weapon } from '../shared/types.ts';
import { WEAPONS } from '../shared/types.ts';

const STORAGE_KEY = 'turbo:language';
let language: Language = 'en';
try {
  language = parseLanguage(localStorage.getItem(STORAGE_KEY));
} catch {
  /* Storage is optional. */
}
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const t = (message: Message, values?: Values) => translate(message, language, values);
export const translateMessage = (message: string) => translate(message, language);
export function onLanguageChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function updateDocument() {
  document.documentElement.lang = language;
  document.title = t('Gaz. Chaos. Rewanż.') + ' — Turbo Rumble';
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      'content',
      language === 'en'
        ? 'Turbo Rumble — one shared screen, phones as controllers. Race, fire rockets and survive the mayhem.'
        : 'Turbo Rumble — wspólny ekran, telefony jako pady. Wyścigi, rakiety i walka o przetrwanie.',
    );
}
export function setLanguage(next: Language) {
  if (next === language) return;
  language = next;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* Private browsing can deny storage. */
  }
  updateDocument();
  for (const listener of listeners) listener();
}
updateDocument();
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) setLanguage(parseLanguage(event.newValue));
});

/** Bind known static template text once, before player content is inserted.
 * Dynamic state uses t() explicitly. No DOM observer, reload or input replacement. */
export function bindTranslations(root: HTMLElement) {
  const bindings: (() => void)[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('script,style,[data-no-i18n]')) continue;
    const text = node.textContent ?? '',
      source = text.trim().replace(/\s+/g, ' ');
    if (!Object.hasOwn(EN, source)) continue;
    const target = node,
      prefix = text.match(/^\s*/)?.[0] ?? '',
      suffix = text.match(/\s*$/)?.[0] ?? '';
    bindings.push(() => {
      target.textContent = prefix + t(source as Message) + suffix;
    });
  }
  for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')])
    for (const attribute of ['aria-label', 'title', 'alt', 'placeholder']) {
      const source = element.getAttribute(attribute);
      if (source && Object.hasOwn(EN, source))
        bindings.push(() => element.setAttribute(attribute, t(source as Message)));
    }
  const render = () => {
    for (const binding of bindings) binding();
  };
  render();
  return onLanguageChange(render);
}
let disposePage: (() => void) | undefined;
export function mountLanguageSwitch(root: HTMLElement) {
  disposePage?.();
  const bar = root.querySelector('.topbar, .pad-header');
  if (!bar) return;
  const picker = document.createElement('div');
  picker.className = 'language-switch';
  picker.setAttribute('role', 'group');
  picker.innerHTML =
    '<button type="button" data-language="en" lang="en" title="English" aria-label="English">EN</button><button type="button" data-language="pl" lang="pl" title="Polski" aria-label="Polski">PL</button>';
  bar.append(picker);
  for (const button of picker.querySelectorAll<HTMLButtonElement>('button'))
    button.onclick = () => setLanguage(parseLanguage(button.dataset.language));
  const render = () => {
    picker.setAttribute('aria-label', language === 'en' ? 'Language' : 'Język');
    for (const button of picker.querySelectorAll('button'))
      button.setAttribute('aria-pressed', String(button.dataset.language === language));
  };
  const stopText = bindTranslations(root),
    stopPicker = onLanguageChange(render);
  render();
  disposePage = () => {
    stopText();
    stopPicker();
  };
}
export function weaponText(weapon: Weapon) {
  const definition = WEAPONS[weapon];
  return {
    ...definition,
    name: translateMessage(definition.name),
    help: translateMessage(definition.help),
  };
}
export function raceMessage(state: Snapshot) {
  if (state.phase === 'finished')
    return t('{name} wygrywa!', { name: state.results[0]?.name ?? t('Gracz') });
  return translateMessage(state.message);
}
