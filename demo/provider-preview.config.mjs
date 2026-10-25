export default {
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://provider-api:8001' },
  },
};
