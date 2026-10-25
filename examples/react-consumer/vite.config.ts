import { defineConfig } from 'vite';
export default defineConfig({
  server: { proxy: { '/captcha-api': {
    target: 'http://127.0.0.1:8001',
    rewrite: path => path.replace(/^\/captcha-api/, '/api'),
  } } },
  preview: { proxy: { '/captcha-api': {
    target: 'http://127.0.0.1:8001',
    rewrite: path => path.replace(/^\/captcha-api/, '/api'),
  } } },
});
