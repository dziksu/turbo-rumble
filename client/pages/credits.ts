import { app, header } from '../core/dom.ts';
import { mountLanguageSwitch } from '../i18n.ts';
export function creditsPage() {
  document.body.className = 'credits-page';
  app.innerHTML = `${header('<span class="edition">Zasoby i licencje</span>')}
  <main class="credits-main"><p class="eyebrow">TURBO RUMBLE</p><h1>Zasoby i gotowe rozwiązania</h1>
  <h2>Licencja gry</h2>
  <p><a href="https://polyformproject.org/licenses/noncommercial/1.0.0">PolyForm Noncommercial 1.0.0</a><span> — autorski kod gry do użytku niekomercyjnego. Zewnętrzne zasoby zachowują własne licencje.</span></p>
  <p>Required Notice: Copyright 2026 Benjamin Rast (https://github.com/dziksu)</p>
  <p>Modele i biblioteki są dostępne bez opłat. Gra nie korzysta z kodu, grafik ani muzyki Racing Wars.</p><ul>
  <li><a href="https://kenney.nl/assets/car-kit">Kenney Car Kit</a><span> — samochody, licencja </span><a href="/assets/cars/LICENSE.txt">CC0</a>.</li>
  <li><a href="https://kenney.nl/assets/nature-kit">Kenney Nature Kit</a><span> — palmy, kaktusy i skały, licencja </span><a href="/assets/nature/LICENSE.txt">CC0</a>.</li>
  <li><a href="https://kenney.nl/assets/city-kit-suburban">Kenney City Kit (Suburban) 2.0</a><span> — domy i zabudowa, licencja </span><a href="/assets/desert/suburban/LICENSE.txt">CC0</a>.</li>
  <li><a href="https://kenney.nl/assets/city-kit-commercial">Kenney City Kit (Commercial) 2.1</a><span> — sklepy i detale uliczne, licencja </span><a href="/assets/desert/commercial/LICENSE.txt">CC0</a>.</li>
  <li><a href="https://kenney.nl/assets/blaster-kit">Kenney Blaster Kit 2.1</a><span> — modele broni i tekstura, licencja </span><a href="/assets/weapons/LICENSE.txt">CC0</a>.</li>
  <li><a href="https://opengameart.org/content/racing-car-engine-sound-loops">domasx2 — Racing car engine sound loops</a><span> — silnik, licencja </span><a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a>.</li>
  <li><a href="https://opengameart.org/content/car-tire-squeal-skid-loop">audible-edge (Tom Haigh), edited by qubodup — Car tire squeal skid loop</a><span> — odgłos poślizgu, licencja </span><a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>.</li>
  <li><a href="https://opengameart.org/content/pixel-sprinter">Zane Little Music — Pixel Sprinter</a><span> — muzyka, licencja </span><a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a>.</li>
  <li><a href="https://kenney.nl/assets/impact-sounds">Kenney Impact Sounds</a> / <a href="https://kenney.nl/assets/sci-fi-sounds">Sci-fi Sounds</a><span> — efekty zderzeń i broni, licencja </span><a href="/assets/audio/SOURCE.md">CC0</a>.</li>
  <li><span>Nagrania przycięto, wyrównano głośność i przygotowano pętle.</span></li>
  <li><a href="https://threejs.org/">Three.js</a><span> — grafika 3D, MIT.</span></li>
  <li><a href="https://rapier.rs/">Rapier</a><span> — fizyka 3D, Apache 2.0.</span></li>
  <li><a href="https://socket.io/">Socket.IO</a><span> — pokoje i połączenia, MIT.</span></li>
  <li><a href="https://github.com/soldair/node-qrcode">QRCode</a><span> — generowanie kodów QR, MIT.</span></li>
  <li>Bungee i Space Grotesk — lokalnie dostarczane fonty, SIL Open Font License.</li>
  <li>Vite, Express, TypeScript i tsx — narzędzia budowania i serwer, licencje w pakietach npm.</li></ul>
  <p>Rakieta i mina korzystają z dopasowanych modeli Kenney. Kula mrozu, cewka impulsu, zbiorniki nitro i mocowania to geometria przygotowana dla Turbo Rumble.</p>
  <h2>Ilustracje menu</h2><p>Filmowe tła wygenerowano z pomocą AI na podstawie modeli używanych w grze. Są ilustracjami promocyjnymi, nie zrzutami rozgrywki.</p>
  <p><a href="/author">Autor gry</a></p>
  <a class="button primary" href="/">Wróć na stronę główną</a></main>`;
  mountLanguageSwitch(app);
}
