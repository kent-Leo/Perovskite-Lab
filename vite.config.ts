import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aiRelayPlugin } from './server/vite-ai-v0.9.1-2026.10.27';
export default defineConfig({
  plugins: [react(), aiRelayPlugin()],
  base: './',
  build: {
    rollupOptions: {
      input: { main: 'index.html', worksheet: 'worksheet-v0.3.0-2026.10.27.html' },
    },
  },
});
