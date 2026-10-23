import QRCode from 'qrcode';
import { app, $, header } from '../core/dom.ts';
import { api } from '../core/api.ts';
import { roomLinks } from '../core/room-links.ts';
import { mountLanguageSwitch, onLanguageChange, t, translateMessage } from '../i18n.ts';
import type { RoomInfo } from '../../shared/protocol.ts';

export async function roomPage(code: string) {
  code = code.toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    location.replace('/join');
    return;
  }
  document.body.className = 'join-page room-page';
  app.innerHTML = `${header('<span class="edition">JEDEN POKÓJ. CAŁA EKIPA.</span>')}
    <main class="room-main">
      <section class="join-card room-choice" aria-labelledby="room-title">
        <p class="eyebrow">ZAPROSZENIE DO GRY</p>
        <h1 id="room-title">Wybierz, jak dołączasz.</h1>
        <p class="room-code">KOD POKOJU <strong>${code}</strong></p>
        <p id="room-status" role="status" aria-live="polite">Ładowanie danych…</p>
        <div id="room-options" hidden>
          <a class="button primary" id="watch-room" href="/watch/${code}">Oglądaj rozgrywkę <span>↗</span></a>
          <p>Podgląd na żywo na komputerze, telewizorze lub telefonie.</p>
          <a class="button secondary" id="control-room" href="/join?code=${code}&mode=controller">Dołącz jako kontroler <span>→</span></a>
          <p>Steruj swoim autem na tym urządzeniu.</p>
          <p id="room-join-help"></p>
        </div>
        <p id="room-error" class="form-error" role="alert" hidden></p>
        <button class="button subtle" id="room-retry" hidden>Spróbuj ponownie</button>
        <a class="room-home" href="/">Wróć na stronę główną</a>
      </section>
      <aside class="join-card room-qr" aria-labelledby="room-qr-title">
        <p class="eyebrow">TELEFON JAKO PAD</p>
        <h2 id="room-qr-title">Zeskanuj i graj.</h2>
        <img id="room-qr" width="260" height="260" alt="Zeskanuj, aby dołączyć telefonem" />
        <p>Zeskanuj kod QR aparatem telefonu, aby otworzyć kontroler.</p>
        <a id="room-controller-link" href="/join?code=${code}&mode=controller">Otwórz pad ↗</a>
        <p id="room-address" class="network-instruction"></p>
      </aside>
    </main>`;
  mountLanguageSwitch(app);
  let info: RoomInfo | null = null,
    error = '',
    address = '';
  const render = () => {
    $('#room-options').hidden = !info;
    $('#room-error').hidden = !error;
    $('#room-error').textContent = translateMessage(error);
    $('#room-retry').hidden = !error;
    $('#room-status').textContent = info
      ? t('Miejsca w pokoju: {players}/8', { players: info.players })
      : '';
    $('#room-join-help').textContent = !info
      ? ''
      : info.players >= 8
        ? t('Wszystkie miejsca są zajęte. Możesz oglądać lub wrócić na swój zapisany kontroler.')
        : ['racing', 'segment', 'paused'].includes(info.phase)
          ? t('Wyścig trwa. Oglądaj teraz, wróć na swój kontroler lub zajmij nowe miejsce w lobby.')
          : t('Nowy gracz zajmuje miejsce dopiero po podaniu pseudonimu.');
    $('#room-address').textContent = address
      ? t('Otwórz na telefonie · {address}', { address })
      : '';
  };
  const refresh = async () => {
    try {
      info = await api<RoomInfo>('/api/rooms/' + code);
      error = '';
    } catch (e) {
      info = null;
      error = (e as Error).message;
    }
    render();
  };
  const stopLanguage = onLanguageChange(render);
  $('#room-retry').onclick = () => void refresh();
  const timer = setInterval(() => void refresh(), 5000);
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(timer);
      stopLanguage();
    },
    { once: true },
  );
  await Promise.all([
    refresh(),
    (async () => {
      const links = await roomLinks(code);
      address = links.base.replace(/^https?:\/\//, '');
      $('#room-controller-link').setAttribute('href', links.controller);
      $<HTMLImageElement>('#room-qr').src = await QRCode.toDataURL(links.controller, {
        width: 300,
        margin: 2,
        color: { dark: '#19293a', light: '#fffaf0' },
      });
      render();
    })(),
  ]);
}
