import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // The API server (npm run server) listens on 3001 during development.
    proxy: { '/api': 'http://localhost:3001' },
  },
});
