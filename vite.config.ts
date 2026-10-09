import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  plugins: [glsl()],
  // /api goes to the leaderboard server (`npm run server`, port 3000) in dev; the game copes when it is not running.
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: { chunkSizeWarningLimit: 900 },
});
