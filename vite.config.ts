import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', port: 5173 },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // The proof sheet ships too — it is the tool you use to judge the art.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        proof: resolve(__dirname, 'proof.html'),
      },
    },
  },
});
