import {
  EN,
  parseLanguage,
  languageLocale,
  translate,
  type Language,
  type Message,
  type Values,
} from './i18n/messages.ts';
import type { Snapshot, Weapon } from '../shared/types.ts';
import { WEAPONS } from '../shared/types.ts';
import { pageMetadata } from '../shared/site-metadata.ts';

const STORAGE_KEY = 'turbo:language';
let language: Language = 'en';
try {
  language = parseLanguage(localStorage.getItem(STORAGE_KEY));
} catch {
  /* Storage is optional. */
}
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const getLocale = () => languageLocale(language);
export const t = (message: Message, values?: Values) => translate(message, language, values);
export const translateMessage = (message: string) => translate(message, language);
export function onLanguageChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function updateDocument() {
  const meta = pageMetadata(location.pathname, language);
  document.documentElement.lang = language;
  document.title = meta.title;
  for (const [selector, content] of [
    ['meta[name="description"]', meta.description],
    ['meta[property="og:title"]', meta.title],
    ['meta[property="og:description"]', meta.description],
    ['meta[property="og:locale"]', meta.locale],
    ['meta[property="og:locale:alternate"]', language === 'en' ? 'pl_PL' : 'en_US'],
    ['meta[property="og:image:alt"]', meta.imageAlt],
    ['meta[name="twitter:title"]', meta.title],
    ['meta[name="twitter:description"]', meta.description],
    ['meta[name="twitter:image:alt"]', meta.imageAlt],
  ])
    document.querySelector(selector!)?.setAttribute('content', content!);
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
  const bar = root.querySelector('.topbar, .pad-header, [data-language-switch]');
  if (!bar) return;
  const picker = document.createElement('div');
  picker.className = 'language-switch';
  const select = document.createElement('select');
  select.className = 'language-select';
  select.innerHTML =
    '<option value="en" lang="en">🇬🇧 English</option><option value="pl" lang="pl">🇵🇱 Polski</option>';
  picker.append(select);
  bar.append(picker);
  select.onchange = () => setLanguage(parseLanguage(select.value));
  const render = () => {
    select.setAttribute('aria-label', language === 'en' ? 'Language' : 'Język');
    select.value = language;
  };
  const stopText = bindTranslations(root),
    stopPicker = onLanguageChange(render);
  render();
  disposePage = () => {
    stopText();
    stopPicker();
    picker.remove();
  };
  return disposePage;
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
