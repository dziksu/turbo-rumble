import { app, header } from '../core/dom.ts';
import { mountLanguageSwitch } from '../i18n.ts';

export function authorPage() {
  document.body.className = 'credits-page author-page';
  app.innerHTML = `${header('<span class="edition">Autor gry</span>')}
    <main class="credits-main author-main">
      <p class="eyebrow">CZŁOWIEK ZA ROZRÓBĄ</p>
      <div class="author-identity"><span class="author-monogram" aria-hidden="true">BR</span><div><h1>Benjamin Rast</h1><a href="https://github.com/dziksu">@dziksu ↗</a></div></div>
      <div class="author-links"><a class="button dark" href="https://github.com/dziksu">Profil GitHub <span>↗</span></a><a class="button subtle" href="https://rastwork.pl/">Strona autora <span>↗</span></a></div>
      <section class="author-source"><span class="card-kicker">TURBO RUMBLE</span><h2>Kod gry dla wszystkich.</h2><p>Kod źródłowy gry jest dostępny na GitHubie do użytku niekomercyjnego.</p><a class="source-status" href="https://github.com/dziksu/turbo-rumble">Repozytorium GitHub ↗</a></section>
      <nav class="author-navigation"><a class="button primary" href="/">Wróć na stronę główną</a><a href="/credits">Zasoby i licencje</a></nav>
    </main>`;
  mountLanguageSwitch(app);
}
