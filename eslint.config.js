import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'server/node_modules', 'server/data', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/sim/**', 'src/protocol/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The shared simulation and the online protocol run in the browser and on the server: no three.js, no browser
    // APIs, and every random choice from the world's seeded Rng so the simulation stays deterministic.
    files: ['src/sim/**/*.ts', 'src/protocol/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['three', 'three/*', '*.glsl'], message: 'src/sim and src/protocol must not depend on rendering (the server runs them).' }] },
      ],
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'performance', 'requestAnimationFrame'].map((name) => ({
          name,
          message: 'src/sim and src/protocol must not use browser APIs (the server runs them).',
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the world Rng so the simulation stays deterministic.' },
        { object: 'Date', property: 'now', message: 'The simulation runs on its own fixed steps, not the wall clock.' },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'server/**/*.ts', 'src/sim/test/**/*.ts', 'scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
