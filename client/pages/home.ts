import { GAME_VERSION } from '../../shared/version.ts';
import { mountServerStats } from '../server-stats.ts';
import { mountCinematicBackground } from '../cinematic-background.ts';
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
  document.body.className = 'home-page cinematic-home';
  app.innerHTML = /* HTML */ ` <div class="cinema-backdrop" aria-hidden="true">
      <img
        class="cinema-image is-active"
        src="/assets/cinematics/desert.webp"
        alt=""
        fetchpriority="high"
        decoding="async"
      />
      <img class="cinema-image" alt="" decoding="async" />
      <div class="cinema-shade"></div>
    </div>
    ${header('<span class="edition">PARTY RACER <i></i> 2–8 GRACZY</span><button class="text-button" id="open-rules">Jak grać <span>↗</span></button>')}
    <main class="launch-main">
      <section class="launch-copy" aria-labelledby="launch-title">
        <p class="eyebrow"><span class="live-dot"></span> JEDEN EKRAN. CAŁA EKIPA.</p>
        <h1 id="launch-title">
          <span class="visually-hidden">Turbo Rumble — </span>MAŁE AUTA.<br />WIELKA<br /><span
            >ROZRÓBA.</span
          >
        </h1>
        <p class="launch-description">
          Darmowe wyścigi w przeglądarce dla 2–8 graczy. Zamień telefon w pad.
        </p>
        <p class="launch-device">NA KOMPUTERZE LUB TV</p>
        <button class="button primary" id="create-room">Stwórz pokój <span>↗</span></button>
        <p class="launch-hint">To będzie wspólny ekran. Telefony posłużą jako pady.</p>
        <div class="launch-tags">
          <span>Bez instalacji</span><span>Darmowa gra</span><span>Telefon = pad</span>
        </div>
      </section>
      <aside class="launch-join" aria-labelledby="join-title">
        <span class="card-kicker">NA TELEFONIE</span>
        <h2 id="join-title">Ekipa już czeka?</h2>
        <p>Wpisz kod z dużego ekranu.</p>
        <form id="join-form">
          <label for="room-code">KOD POKOJU</label>
          <div class="launch-code-row">
            <input
              id="room-code"
              name="code"
              maxlength="6"
              placeholder="ABC123"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              required
              pattern="[A-Za-z2-9]{6}"
            />
            <button class="button" type="submit">Dołącz <span>→</span></button>
          </div>
        </form>
        <span class="launch-join-hint">Otwórz tę stronę na swoim telefonie.</span>
      </aside>
      <div class="cinema-controls" aria-label="Sceny w tle">
        <div class="cinema-caption">
          <span id="scene-counter">01 / 03</span><strong id="scene-name">SUNDOWN JUNCTION</strong
          ><span class="cinema-art-label">FILMOWE SCENY</span>
        </div>
        <div class="cinema-buttons">
          <button class="scene-dot" data-scene="0" aria-label="Pustynia" aria-pressed="true">
            <span>01</span>
          </button>
          <button class="scene-dot" data-scene="1" aria-label="Las" aria-pressed="false">
            <span>02</span>
          </button>
          <button class="scene-dot" data-scene="2" aria-label="Wulkan" aria-pressed="false">
            <span>03</span>
          </button>
          <button
            class="cinema-pause"
            id="cinema-pause"
            aria-label="Wstrzymaj animację"
            aria-pressed="false"
          >
            Ⅱ
          </button>
        </div>
      </div>
    </main>
    <footer class="launch-footer">
      <div class="server-stats" aria-label="Statystyki serwera" data-no-i18n>
        <span class="server-status-light" aria-hidden="true"></span>
        <dl class="server-counts">
          <div>
            <dt data-stat-label="players"></dt>
            <dd data-stat="players">—</dd>
          </div>
          <div>
            <dt data-stat-label="activeRooms"></dt>
            <dd data-stat="activeRooms">—</dd>
          </div>
          <div>
            <dt data-stat-label="rooms"></dt>
            <dd data-stat="rooms">— / —</dd>
          </div>
        </dl>
        <span class="server-stats-error" hidden></span>
        <span class="visually-hidden" role="status" data-stat-status></span>
      </div>
      <nav aria-label="Informacje o grze">
        <a href="/author">Autor</a><a href="/credits">Zasoby i licencje</a
        ><a class="repo-link" href="https://github.com/dziksu/turbo-rumble">Kod źródłowy ↗</a>
        <a
          class="game-version"
          href="https://github.com/dziksu/turbo-rumble/blob/main/CHANGELOG.md"
          title="Historia zmian"
          >v${GAME_VERSION}</a
        >
      </nav>
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
            aby odzyskać przyczepność. Oba przyciski naraz hamują; przytrzymaj je po zatrzymaniu,
            aby cofać. Zostań w kadrze, unikaj przepaści i zbieraj przedmioty.
          </p>
        </article>
        <article>
          <b>03 / RÓB ZAMIESZANIE</b>
          <p>
            Użyj rakiety, miny, mrozu, impulsu lub nitro. Startujesz z 5 punktami. Wygrywa ustalony
            próg punktów lub najlepszy wynik po wybranej liczbie okrążeń. Host lub pierwszy gracz
            ustala zasady; wszyscy gotowi uruchamiają odliczanie 5 sekund.
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
  mountCinematicBackground(app);
  mountServerStats(app);
}
