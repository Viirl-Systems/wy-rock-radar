import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1500,
  },
  plugins: [react()],
  server: {
    port: 5173,
  },
});
