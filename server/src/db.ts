import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RunSubmission } from '../../src/leaderboard/rules.ts';

export interface TopEntry {
  rank: number;
  nickname: string;
  score: number;
  tier: number;
}

/**
 * Score storage. Every accepted run is kept; the board ranks players by their best run, with
 * nicknames compared case-insensitively (no accounts, so a nickname is all that groups runs).
 */
export class ScoreStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY,
        nickname TEXT NOT NULL,
        score INTEGER NOT NULL,
        tier INTEGER NOT NULL,
        seconds REAL NOT NULL,
        eaten INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS scores_by_name ON scores (nickname COLLATE NOCASE, score DESC);
      CREATE INDEX IF NOT EXISTS scores_by_score ON scores (score DESC);
    `);
  }

  add(run: RunSubmission, now = Date.now()): void {
    this.db
      .prepare('INSERT INTO scores (nickname, score, tier, seconds, eaten, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(run.nickname, run.score, run.tier, run.seconds, run.eaten, now);
  }

  /** Best run per player, highest first. Ties go to whoever got there first. */
  top(limit: number): TopEntry[] {
    const rows = this.db
      .prepare(
        `SELECT nickname, score, tier FROM (
           SELECT nickname, score, tier, created_at,
                  ROW_NUMBER() OVER (PARTITION BY nickname COLLATE NOCASE ORDER BY score DESC, created_at ASC) AS n
           FROM scores
         ) WHERE n = 1 ORDER BY score DESC, created_at ASC LIMIT ?`,
      )
      .all(limit) as { nickname: string; score: number; tier: number }[];
    return rows.map((r, i) => ({ rank: i + 1, nickname: r.nickname, score: r.score, tier: r.tier }));
  }

  /** Place a score would take among the players' best runs (other than `nickname`'s own), and how many players there are. */
  rank(score: number, nickname = ''): { rank: number; total: number } {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN best > ? AND name <> ? COLLATE NOCASE THEN 1 ELSE 0 END) AS above,
           COUNT(*) AS total,
           SUM(CASE WHEN name = ? COLLATE NOCASE THEN 1 ELSE 0 END) AS mine
         FROM (SELECT nickname AS name, MAX(score) AS best FROM scores GROUP BY nickname COLLATE NOCASE)`,
      )
      .get(score, nickname, nickname) as { above: number | null; total: number; mine: number | null };
    // A score not yet stored counts itself as one more player.
    const total = row.total + (nickname && row.mine ? 0 : 1);
    return { rank: (row.above ?? 0) + 1, total };
  }

  /** Number of distinct players on the board. */
  players(): number {
    const row = this.db.prepare('SELECT COUNT(DISTINCT nickname COLLATE NOCASE) AS n FROM scores').get() as { n: number };
    return row.n;
  }

  /** The best score stored for a nickname, or 0. */
  best(nickname: string): number {
    const row = this.db.prepare('SELECT MAX(score) AS best FROM scores WHERE nickname = ? COLLATE NOCASE').get(nickname) as { best: number | null };
    return row.best ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
