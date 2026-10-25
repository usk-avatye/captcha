import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./src/bundle.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'style',
    },
    rolldownOptions: { external: [/^react(?:\/|$)/, /^react-dom(?:\/|$)/] },
    minify: false,
  },
});
