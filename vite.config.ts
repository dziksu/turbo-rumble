import { defineConfig } from 'vite';
import { renderPageHtml } from './shared/site-metadata.ts';
export default defineConfig({
  plugins: [
    {
      name: 'public-page-metadata',
      transformIndexHtml: {
        order: 'pre',
        handler(html, context) {
          if (context.path === '/scripts/social-card.html') return html;
          return renderPageHtml(html, context.server ? context.path : '/');
        },
      },
    },
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  server: { host: '0.0.0.0' },
});
