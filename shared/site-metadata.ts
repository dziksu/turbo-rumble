export const SITE_URL = 'https://turborumble.rastwork.pl';
export const SOCIAL_IMAGE_PATH = '/social/turbo-rumble-og.jpg';
export type SiteLanguage = 'en' | 'pl';

const copy = {
  en: {
    home: {
      title: 'Turbo Rumble — Free Multiplayer Browser Racing',
      description:
        'Race with 2–8 friends on one shared screen. Use phones as controllers, drift across three maps and fire rockets. Play Turbo Rumble free in your browser.',
    },
    author: {
      title: 'Benjamin Rast — Creator of Turbo Rumble',
      description:
        'Meet Benjamin Rast, the creator of Turbo Rumble. Find his GitHub profile, website and the game’s source code.',
    },
    credits: {
      title: 'Credits & Licenses — Turbo Rumble',
      description:
        'Credits, asset sources and licenses for Turbo Rumble, including Kenney models, music, sound effects and the game’s noncommercial code license.',
    },
    private: {
      title: 'Play with Your Crew — Turbo Rumble',
      description: 'One shared screen. Phones as controllers. Join your friends in Turbo Rumble.',
    },
    missing: {
      title: 'Page Not Found — Turbo Rumble',
      description: 'Return to Turbo Rumble and start a race with your friends.',
    },
    imageAlt:
      'Turbo Rumble cinematic menu illustration with low-poly racing cars, an explosion and the words Tiny cars. Big mayhem.',
  },
  pl: {
    home: {
      title: 'Turbo Rumble — Darmowe wyścigi dla 2–8 graczy',
      description:
        'Ścigaj się z ekipą 2–8 graczy na wspólnym ekranie. Telefony jako pady, trzy mapy, drift i rakiety. Zagraj w Turbo Rumble za darmo w przeglądarce.',
    },
    author: {
      title: 'Benjamin Rast — Autor Turbo Rumble',
      description:
        'Benjamin Rast, autor Turbo Rumble. Profil GitHub, strona autora i kod źródłowy gry.',
    },
    credits: {
      title: 'Zasoby i licencje — Turbo Rumble',
      description:
        'Autorzy, źródła i licencje Turbo Rumble: modele Kenney, muzyka, dźwięki i licencja kodu gry do użytku niekomercyjnego.',
    },
    private: {
      title: 'Zagraj ze swoją ekipą — Turbo Rumble',
      description: 'Jeden wspólny ekran. Telefony jako pady. Dołącz do znajomych w Turbo Rumble.',
    },
    missing: {
      title: 'Nie znaleziono strony — Turbo Rumble',
      description: 'Wróć do Turbo Rumble i rozpocznij wyścig ze znajomymi.',
    },
    imageAlt:
      'Filmowa ilustracja menu Turbo Rumble: samochody low poly, wybuch i napis Tiny cars. Big mayhem.',
  },
} as const;

export function pageMetadata(pathname: string, language: SiteLanguage = 'en', origin = SITE_URL) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const page =
    path === '/'
      ? 'home'
      : path === '/author'
        ? 'author'
        : path === '/credits'
          ? 'credits'
          : path === '/join' || path.startsWith('/host/')
            ? 'private'
            : 'missing';
  const indexable = page === 'home' || page === 'author' || page === 'credits';
  return {
    ...copy[language][page],
    page,
    indexable,
    robots: indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow',
    canonical: new URL(indexable ? path : '/', origin).href,
    image: new URL(SOCIAL_IMAGE_PATH, origin).href,
    imageAlt: copy[language].imageAlt,
    locale: language === 'pl' ? 'pl_PL' : 'en_US',
  };
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function staticContent(page: ReturnType<typeof pageMetadata>['page']) {
  if (page === 'home')
    return `<main class="html-fallback"><h1>Turbo Rumble — Free Multiplayer Browser Racing</h1><p>A party racing game for 2–8 players. Put the race on one computer or TV and use your phones as controllers. Play free in your browser, with keyboard controls and bots also available.</p><h2>One screen. Your whole crew.</h2><p>Create a room on the shared screen. Scan its QR code or enter the room code on each phone. The hosted game works across different networks.</p><h2>Three maps, drifting and explosive races</h2><p>Race through Sundown Junction, Timber Run and Aloha Inferno. Acceleration is automatic: steer, drift, brake and use rockets, mines, frost, pulse or nitro to stay in the race.</p><noscript><p>Enable JavaScript to create a room or join a game.</p></noscript><nav><a href="/author">Creator</a> · <a href="/credits">Credits &amp; licenses</a> · <a href="https://github.com/dziksu/turbo-rumble">Source code on GitHub</a></nav></main>`;
  if (page === 'author')
    return '<main class="html-fallback"><h1>Benjamin Rast — Creator of Turbo Rumble</h1><p><a href="https://github.com/dziksu">GitHub: @dziksu</a> · <a href="https://rastwork.pl/">Creator’s website</a></p><p><a href="https://github.com/dziksu/turbo-rumble">Turbo Rumble source code</a> is available under PolyForm Noncommercial 1.0.0.</p><a href="/">Play Turbo Rumble</a></main>';
  if (page === 'credits')
    return '<main class="html-fallback"><h1>Turbo Rumble — Credits &amp; Licenses</h1><p>Original game code: <a href="https://polyformproject.org/licenses/noncommercial/1.0.0">PolyForm Noncommercial 1.0.0</a>. Third-party resources retain their own licenses.</p><p>Kenney models are CC0. The tire-skid recording by audible-edge (Tom Haigh), edited by qubodup, is CC BY 3.0. <a href="/assets/audio/SOURCE.md">Audio credits and changes</a>. Three.js and Socket.IO are MIT; Rapier is Apache 2.0; Bungee and Space Grotesk use SIL OFL.</p><p>Menu illustrations were generated with AI using the game’s models as references. <a href="/assets/cinematics/SOURCE.md">Illustration provenance</a>.</p><noscript><p>Enable JavaScript to view the full interactive credits page.</p></noscript><a href="/">Play Turbo Rumble</a></main>';
  if (page === 'private')
    return '<main class="html-fallback"><h1>Turbo Rumble</h1><p>Enable JavaScript to host or join a game.</p><a href="/">Back to home</a></main>';
  return '<main class="html-fallback"><h1>Page not found</h1><a href="/">Play Turbo Rumble</a></main>';
}

export function renderPageHtml(html: string, pathname = '/', origin = SITE_URL) {
  const meta = pageMetadata(pathname, 'en', origin);
  const tag = (attribute: 'name' | 'property', key: string, content: string) =>
    `<meta ${attribute}="${key}" content="${escape(content)}" />`;
  const tags = [
    `<title>${escape(meta.title)}</title>`,
    tag('name', 'description', meta.description),
    tag('name', 'robots', meta.robots),
    `<link rel="canonical" href="${escape(meta.canonical)}" />`,
    tag('property', 'og:type', 'website'),
    tag('property', 'og:site_name', 'Turbo Rumble'),
    tag('property', 'og:title', meta.title),
    tag('property', 'og:description', meta.description),
    tag('property', 'og:url', meta.canonical),
    tag('property', 'og:locale', meta.locale),
    tag('property', 'og:locale:alternate', 'pl_PL'),
    tag('property', 'og:image', meta.image),
    tag('property', 'og:image:secure_url', meta.image),
    tag('property', 'og:image:type', 'image/jpeg'),
    tag('property', 'og:image:width', '1200'),
    tag('property', 'og:image:height', '630'),
    tag('property', 'og:image:alt', meta.imageAlt),
    tag('name', 'twitter:card', 'summary_large_image'),
    tag('name', 'twitter:title', meta.title),
    tag('name', 'twitter:description', meta.description),
    tag('name', 'twitter:image', meta.image),
    tag('name', 'twitter:image:alt', meta.imageAlt),
  ];
  if (meta.page === 'home') {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': `${meta.canonical}#website`,
          url: meta.canonical,
          name: 'Turbo Rumble',
          inLanguage: ['en', 'pl'],
        },
        {
          '@type': 'VideoGame',
          '@id': `${meta.canonical}#game`,
          name: 'Turbo Rumble',
          url: meta.canonical,
          description: meta.description,
          image: meta.image,
          genre: ['Racing', 'Party game'],
          gamePlatform: 'Web browser',
          playMode: 'https://schema.org/MultiPlayer',
          numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 8 },
          inLanguage: ['en', 'pl'],
          isAccessibleForFree: true,
          author: { '@type': 'Person', name: 'Benjamin Rast', url: 'https://rastwork.pl/' },
          license: 'https://polyformproject.org/licenses/noncommercial/1.0.0',
        },
      ],
    };
    tags.push(
      `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`,
    );
  }
  return html
    .replace(
      /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,
      `<!-- seo:start -->\n${tags.join('\n')}\n<!-- seo:end -->`,
    )
    .replace(
      /<!-- static-content:start -->[\s\S]*?<!-- static-content:end -->/,
      `<!-- static-content:start -->${staticContent(meta.page)}<!-- static-content:end -->`,
    );
}
