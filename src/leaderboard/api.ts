import { LEADERBOARD } from '../config';
import type { RunSubmission } from './rules';

export interface BoardEntry {
  rank: number;
  nickname: string;
  score: number;
  tier: number;
  holes?: number;
  /** The best run was played in an offline arena (bots only). */
  offline?: boolean;
}
export interface TopList {
  entries: BoardEntry[];
  total: number;
}
export interface SubmitResult {
  nickname: string;
  rank: number;
  total: number;
  best: number;
  personalBest: boolean;
}
export type SubmitOutcome =
  | { status: 'ok'; result: SubmitResult }
  | { status: 'rejected'; reason: 'nickname' | 'implausible' | 'invalid' | 'rate' }
  | { status: 'offline' };

/**
 * Leaderboard client. Every call has a timeout and resolves to null or 'offline' instead of throwing,
 * so the game plays the same with the server down, blocked or slow.
 */
async function request(path: string, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEADERBOARD.timeoutMs);
  try {
    return await fetch(`${LEADERBOARD.base}${path}`, { ...init, signal: controller.signal, headers: { accept: 'application/json', ...init?.headers } });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function json<T>(res: Response | null): Promise<T | null> {
  // Without a server the dev server or a static host may answer with HTML; only JSON counts.
  if (!res || !(res.headers.get('content-type') ?? '').includes('application/json')) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function isTopList(v: unknown): v is TopList {
  const t = v as TopList | null;
  return !!t && Array.isArray(t.entries) && typeof t.total === 'number';
}

export async function fetchTop(limit: number = LEADERBOARD.topLimit): Promise<TopList | null> {
  const body = await json<unknown>(await request(`/scores/top?limit=${limit}`));
  return isTopList(body) ? body : null;
}

/** Players in the online arena right now and rooms open, or null when the server does not answer. */
export async function fetchOnline(): Promise<{ players: number; rooms: number } | null> {
  const body = await json<{ players: number; rooms: number }>(await request('/online'));
  return body && typeof body.players === 'number' && typeof body.rooms === 'number' ? body : null;
}

/** Where a score would place, for a run without a nickname. */
export async function fetchRank(score: number): Promise<{ rank: number; total: number } | null> {
  const res = await request(`/scores/rank?score=${Math.max(0, Math.round(score))}`);
  if (!res?.ok) return null;
  const body = await json<{ rank: number; total: number }>(res);
  return body && typeof body.rank === 'number' ? body : null;
}

export async function submitRun(run: RunSubmission): Promise<SubmitOutcome> {
  const res = await request('/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(run),
  });
  if (!res) return { status: 'offline' };
  if (res.status === 429) return { status: 'rejected', reason: 'rate' };
  const body = await json<SubmitResult & { error?: string }>(res);
  if (!body) return { status: 'offline' };
  if (res.ok && typeof body.rank === 'number') return { status: 'ok', result: body };
  const reason = body.error === 'nickname' || body.error === 'implausible' ? body.error : 'invalid';
  return { status: 'rejected', reason };
}
