import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createGameServer } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { SITE_URL, SOCIAL_IMAGE_PATH } from '../shared/site-metadata.ts';

test('crawlers receive page content, canonical metadata and the real social image without JavaScript', async () => {
  const folder = mkdtempSync(resolve(tmpdir(), 'turbo-seo-'));
  mkdirSync(resolve(folder, 'dist/social'), { recursive: true });
  for (const [source, destination] of [
    ['index.html', 'index.html'],
    ['public/robots.txt', 'robots.txt'],
    ['public/sitemap.xml', 'sitemap.xml'],
    ['public/social/turbo-rumble-og.jpg', 'social/turbo-rumble-og.jpg'],
  ])
    copyFileSync(resolve(source!), resolve(folder, 'dist', destination!));
  const server = await createGameServer({
    ...loadConfig({}, []),
    production: true,
    rootDir: folder,
    dataDir: resolve(folder, 'data'),
    publicUrl: SITE_URL,
    host: '127.0.0.1',
    port: 0,
  });
  try {
    const base = `http://127.0.0.1:${await server.listen()}`;
    const response = await fetch(base + '/', {
      headers: { 'User-Agent': 'facebookexternalhit/1.1' },
    });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<h1>Turbo Rumble — Free Multiplayer Browser Racing<\/h1>/);
    assert.match(html, /phones as controllers/i);
    assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1);
    assert.ok(html.includes(`rel="canonical" href="${SITE_URL}/"`));
    assert.ok(html.includes(`property="og:image" content="${SITE_URL}${SOCIAL_IMAGE_PATH}"`));
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /property="og:image:height" content="630"/);
    const schema = JSON.parse(
      html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!,
    );
    assert.equal(
      schema['@graph'].find((entry: { '@type': string }) => entry['@type'] === 'VideoGame')
        .numberOfPlayers.maxValue,
      8,
    );
    const imageResponse = await fetch(base + SOCIAL_IMAGE_PATH);
    assert.match(imageResponse.headers.get('content-type')!, /image\/jpeg/);
    const image = Buffer.from(await imageResponse.arrayBuffer());
    assert.equal(image.readUInt16BE(0), 0xffd8);
    let dimensions: number[] | undefined;
    for (let offset = 2; offset + 8 < image.length;) {
      const marker = image.readUInt16BE(offset);
      if (marker === 0xffc0 || marker === 0xffc2) {
        dimensions = [image.readUInt16BE(offset + 7), image.readUInt16BE(offset + 5)];
        break;
      }
      offset += 2 + image.readUInt16BE(offset + 2);
    }
    assert.deepEqual(dimensions, [1200, 630]);
    for (const [path, title] of [
      ['/author', 'Benjamin Rast'],
      ['/credits', 'Credits &amp; Licenses'],
    ]) {
      const page = await fetch(base + path);
      const body = await page.text();
      assert.match(body, new RegExp(`<title>.*${title}`));
      assert.ok(body.includes(`rel="canonical" href="${SITE_URL}${path}"`));
      assert.ok(!body.includes('application/ld+json'));
    }
    for (const path of ['/host/ABC234', '/join?code=ABC234']) {
      const page = await fetch(base + path);
      assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.match(await page.text(), /name="robots" content="noindex, nofollow"/);
    }
    const missing = await fetch(base + '/not-a-real-page');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('x-robots-tag'), 'noindex, nofollow');
    const sitemap = await fetch(base + '/sitemap.xml').then((r) => r.text());
    assert.equal((sitemap.match(/<loc>/g) ?? []).length, 3);
    assert.ok(!sitemap.includes('/host/') && !sitemap.includes('/join'));
    const robots = await fetch(base + '/robots.txt').then((r) => r.text());
    assert.ok(robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`));
    assert.ok(readFileSync(resolve('README.md'), 'utf8').includes('](docs/gameplay.png)'));
  } finally {
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
