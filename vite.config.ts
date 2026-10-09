import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  plugins: [glsl()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 900 },
});
