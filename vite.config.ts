import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: { main: 'index.html', worksheet: 'worksheet-v0.2.0-2026.10.19.html' },
    },
  },
});
