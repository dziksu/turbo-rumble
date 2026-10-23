import { mountLanguageSwitch, onLanguageChange, translateMessage } from '../i18n.ts';
import { app, $, header } from '../core/dom.ts';
import { api, safeSession } from '../core/api.ts';
import { roomPage } from './room.ts';
import { controller } from './controller.ts';
import type { Session } from '../../shared/types.ts';
export async function joinPage() {
  const code = new URLSearchParams(location.search).get('code')?.toUpperCase() ?? '';
  if (code && new URLSearchParams(location.search).get('mode') !== 'controller') {
    await roomPage(code);
    return;
  }
  const saved = code ? safeSession('turbo:player:' + code) : null;
  if (saved) {
    controller(saved);
    return;
  }
  document.body.className = 'join-page';
  app.innerHTML = /* HTML */ `${header('<span class="edition">TWÓJ TELEFON. TWÓJ PAD.</span>')}
    <main class="join-main">
      <div class="join-illustration">
        <span>ϟ</span>
        <div class="mini-key">←</div>
        <div class="mini-key">→</div>
        <div class="mini-fire">✹</div>
      </div>
      <section class="join-card big">
        <p class="eyebrow">CZAS NA ROZRÓBĘ</p>
        <h1>Wskakuj do gry.</h1>
        <p>Ten ekran za chwilę zmieni się w pad.</p>
        <form id="player-form">
          <label for="join-code">KOD Z EKRANU HOSTA</label
          ><input
            id="join-code"
            maxlength="6"
            placeholder="ABC123"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            required
            pattern="[A-Za-z2-9]{6}"
          /><label for="nickname">JAK CIĘ NAZWAĆ?</label
          ><input
            id="nickname"
            maxlength="18"
            placeholder="Twój pseudonim"
            autocomplete="nickname"
            required
          />
          <p id="join-error" class="form-error" role="alert"></p>
          <button class="button primary" type="submit">Zajmij miejsce <span>→</span></button>
        </form>
      </section>
    </main>`;
  mountLanguageSwitch(app);
  let lastError = '';
  const stopErrorLanguage = onLanguageChange(() => {
    const error = document.querySelector('#join-error');
    if (error) error.textContent = translateMessage(lastError);
  });
  $<HTMLInputElement>('#join-code').value = code;
  $<HTMLInputElement>('#nickname').value = localStorage.getItem('turbo:name') ?? '';
  $('#player-form').onsubmit = async (e) => {
    e.preventDefault();
    const button = $<HTMLButtonElement>('#player-form button');
    button.disabled = true;
    lastError = '';
    $('#join-error').textContent = '';
    try {
      const name = $<HTMLInputElement>('#nickname').value,
        session = await api<Session>('/api/join', {
          code: $<HTMLInputElement>('#join-code').value,
          name,
        });
      localStorage.setItem('turbo:name', name);
      localStorage.setItem('turbo:player:' + session.code, JSON.stringify(session));
      stopErrorLanguage();
      controller(session);
    } catch (error) {
      lastError = (error as Error).message;
      $('#join-error').textContent = translateMessage(lastError);
      button.disabled = false;
    }
  };
}
