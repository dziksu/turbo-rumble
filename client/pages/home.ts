import { mountLanguageSwitch } from '../i18n.ts';
import { app, $, header, toast } from '../core/dom.ts';
import { api } from '../core/api.ts';
import { type Session } from '../../shared/types.ts';
async function createGame() {
  const button = $<HTMLButtonElement>('#create-room');
  button.disabled = true;
  try {
    const session = await api<Session>('/api/rooms', {});
    localStorage.setItem('turbo:host:' + session.code, JSON.stringify(session));
    location.href = `/host/${session.code}`;
  } catch (e) {
    toast((e as Error).message);
    button.disabled = false;
  }
}
export async function home() {
  document.body.className = 'home-page';
  app.innerHTML = /* HTML */ `${header('<span class="edition">PARTY RACER <i></i> 2–8 GRACZY</span><button class="text-button" id="open-rules">Jak grać <span>↗</span></button>')}
    <main class="home-main">
      <section class="hero-copy">
        <p class="eyebrow"><span class="live-dot"></span> JEDEN EKRAN. CAŁA EKIPA.</p>
        <h1>MAŁE AUTA.<br />WIELKA<br /><span>ROZRÓBA.</span></h1>
        <p class="hero-description">
          Zamień telefon w pad. Skacz, dryfuj i zrób rozróbę ze znajomymi. Jeden ekran, cała ekipa.
        </p>
        <p class="play-device">NA KOMPUTERZE LUB TV</p>
        <button class="button primary large" id="create-room">Stwórz pokój <span>↗</span></button>
        <p class="host-instruction">To będzie wspólny ekran. Telefony posłużą jako pady.</p>
        <div class="hero-tags">
          <span>Bez instalacji</span><span>Darmowa gra</span><span>Telefon = pad</span>
        </div>
      </section>
      <div class="home-visual">
        <div id="home-world" class="home-world" aria-hidden="true"></div>
        <button
          id="intro-toggle"
          class="intro-toggle"
          aria-label="Wstrzymaj animację"
          aria-pressed="false"
        >
          Ⅱ
        </button>
      </div>
      <aside class="join-card home-join-card" id="join-menu">
        <span class="card-kicker">NA TELEFONIE</span>
        <h2>Dołącz do gry.</h2>
        <p class="join-instruction">Wpisz kod z dużego ekranu.</p>
        <form id="join-form">
          <label for="room-code">KOD POKOJU</label
          ><input
            id="room-code"
            name="code"
            maxlength="6"
            placeholder="ABC123"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            required
            pattern="[A-Za-z2-9]{6}"
          /><button class="button dark" type="submit">Dołącz <span>→</span></button>
        </form>
        <span class="join-footnote">Otwórz tę stronę na swoim telefonie.</span>
      </aside>
      <div class="track-label">
        <span class="track-number">03</span
        ><span><small>WYBIERZ SWOJĄ TRASĘ</small><strong>Pustynia · Las · Wulkan</strong></span
        ><span class="track-line"></span><span>3 MAPY / JEDNA EKIPA</span>
      </div>
    </main>
    <footer class="home-footer">
      <span>GAZ. CHAOS. REWANŻ.</span><span><a href="/credits">Zasoby i licencje</a></span>
    </footer>
    <dialog id="rules" aria-labelledby="rules-title">
      <button class="dialog-close" aria-label="Zamknij">×</button>
      <p class="eyebrow">JAK GRAĆ</p>
      <h2 id="rules-title">Gaz jest automatyczny.<br />Reszta zależy od ciebie.</h2>
      <div class="rules-grid">
        <article>
          <b>01 / ZBIERZ EKIPĘ</b>
          <p>
            Host wyświetla grę na komputerze lub TV. Każdy gracz skanuje QR albo wpisuje kod na
            telefonie.
          </p>
        </article>
        <article>
          <b>02 / TRZYMAJ TOR</b>
          <p>
            Lewo i prawo sterują autem. Przytrzymaj zakręt, aby wejść w drift; puść lub skontruj,
            aby odzyskać przyczepność. Oba przyciski naraz hamują. Zostań w kadrze, unikaj przepaści
            i zbieraj przedmioty.
          </p>
        </article>
        <article>
          <b>03 / RÓB ZAMIESZANIE</b>
          <p>
            Użyj rakiety, miny, mrozu, impulsu lub nitro. Startujesz z 5 punktami. Wygrywa ustalony
            próg punktów lub najlepszy wynik po wybranej liczbie okrążeń. Host lub pierwszy gracz
            ustala zasady; wszyscy gotowi uruchamiają odliczanie 10 sekund.
          </p>
        </article>
        <p class="equipment-tip">Broń na dachu zdradza, co ma przeciwnik.</p>
      </div>
    </dialog>`;
  mountLanguageSwitch(app);
  $('#create-room').onclick = () => void createGame();
  $('#join-form').onsubmit = (e) => {
    e.preventDefault();
    location.href =
      '/join?code=' + encodeURIComponent($<HTMLInputElement>('#room-code').value.toUpperCase());
  };
  $('#open-rules').onclick = () => $<HTMLDialogElement>('#rules').showModal();
  $('.dialog-close').onclick = () => $<HTMLDialogElement>('#rules').close();
  void import('../intro-scene.ts')
    .then(({ IntroScene }) => {
      const intro = new IntroScene($('#home-world'), $<HTMLButtonElement>('#intro-toggle'));
      return intro.ready;
    })
    .catch(() => {
      $('#intro-toggle').hidden = true;
      $('#home-world').classList.add('intro-unavailable');
    });
}
