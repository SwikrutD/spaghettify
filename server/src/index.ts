import { buildApp } from './app.ts';

// Entry point in the api container. DB_PATH should sit on a persistent volume.
const app = await buildApp({
  dbPath: process.env.DB_PATH ?? './data/leaderboard.db',
  logger: true,
});
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0), () => process.exit(1));
  });
}
