import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  server: { host: '0.0.0.0' },
});
