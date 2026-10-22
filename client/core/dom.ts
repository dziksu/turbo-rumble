import { translateMessage, onLanguageChange } from '../i18n.ts';
export const app = document.querySelector<HTMLDivElement>('#app')!;
export const logo =
  '<span class="brand-mark">ϟ</span><img class="brand-wordmark" src="/brand-wordmark.svg" width="76" height="35" alt="Turbo Rumble" />';
export const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
export function toast(message: string) {
  let el = document.querySelector('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  (el as HTMLElement).dataset.source = message;
  el.textContent = translateMessage(message);
  el.classList.add('visible');
  setTimeout(() => el?.classList.remove('visible'), 5000);
}
export function header(extra = '') {
  return `<header class="topbar"><a class="brand" href="/" aria-label="Turbo Rumble — strona główna">${logo}</a>${extra}</header>`;
}

onLanguageChange(() => {
  const toast = document.querySelector<HTMLElement>('#toast');
  if (toast) toast.textContent = translateMessage(toast.dataset.source ?? '');
});
