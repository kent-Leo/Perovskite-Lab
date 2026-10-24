import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aiRelayPlugin } from './server/vite-ai-2026.10.24';
export default defineConfig({
  plugins: [react(), aiRelayPlugin()],
  base: './',
  build: {
    rollupOptions: {
      input: { main: 'index.html', worksheet: 'worksheet-v0.2.0-2026.10.19.html' },
    },
  },
});
