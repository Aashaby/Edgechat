import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBuildMetadata } from './build-metadata.js';

const dirname = fileURLToPath(new URL('.', import.meta.url));
const buildMetadata = resolveBuildMetadata();

export default defineConfig({
  root: resolve(dirname),
  plugins: [vue()],
  define: {
    'globalThis.__EDGECHAT_BUILD__': JSON.stringify(buildMetadata),
    'globalThis.__EDGECHAT_DEMO__': 'false'
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      },
      '/files': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve(dirname, 'dist'),
    emptyOutDir: true
  }
});
