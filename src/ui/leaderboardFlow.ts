import { track } from '../analytics/analytics';
import { LEADERBOARD } from '../config';
import { fetchRank, fetchTop, submitRun, type SubmitOutcome } from '../leaderboard/api';
import type { LeaderboardPanel } from './LeaderboardPanel';
import type { RunStats } from './ScoreScreen';

const OFFLINE = 'Leaderboard unavailable right now. Your best is saved on this device.';
const REJECTED: Record<Exclude<SubmitOutcome, { status: 'ok' | 'offline' }>['reason'], string> = {
  nickname: 'That nickname is not allowed on the board. Pick another on the title screen.',
  implausible: 'This run could not be posted.',
  invalid: 'This run could not be posted.',
  rate: 'Too many runs from this connection. Try again in a minute.',
};

/** Bumped each time the score screen opens, so a slow answer from an earlier run is dropped. */
let runToken = 0;

/**
 * Score screen: post the run (when the player has a nickname), then show the top of the board with the
 * player's row lit and their rank. Without a nickname, show where the score would place.
 */
export async function postRunToBoard(panel: LeaderboardPanel, stats: RunStats, nickname: string): Promise<void> {
  const token = ++runToken;
  const stale = () => token !== runToken;
  panel.clear();
  panel.setStatus(nickname ? 'Posting your score...' : 'Loading the leaderboard...');

  if (!nickname) {
    const [top, place] = await Promise.all([fetchTop(), fetchRank(stats.score)]);
    if (stale()) return;
    if (!top) return panel.setStatus(OFFLINE);
    panel.setEntries(top.entries, LEADERBOARD.scoreScreenRows);
    panel.setStatus(
      (place ? `This run would place #${place.rank} of ${place.total}. ` : '') + 'Set a nickname on the title screen to post your scores.',
    );
    return;
  }

  const outcome = await submitRun({ nickname, score: stats.score, tier: stats.tierNumber, seconds: Math.round(stats.seconds * 10) / 10, eaten: stats.eatenCount });
  track('leaderboard-submit', { result: outcome.status === 'rejected' ? outcome.reason : outcome.status, tier: stats.tierNumber });
  if (stale()) return;
  if (outcome.status === 'offline') return panel.setStatus(OFFLINE);

  const top = await fetchTop();
  if (stale()) return;
  if (top) {
    const own = outcome.status === 'ok' ? { rank: outcome.result.rank, nickname: outcome.result.nickname, score: outcome.result.best, tier: stats.tierNumber } : null;
    panel.setEntries(top.entries, LEADERBOARD.scoreScreenRows, outcome.status === 'ok' ? nickname : '', own);
  }
  if (outcome.status === 'rejected') return panel.setStatus(REJECTED[outcome.reason]);
  const r = outcome.result;
  const best = r.personalBest ? 'New personal best. ' : `Your best: ${r.best.toLocaleString('en-US')}. `;
  panel.setStatus(`${best}You are #${r.rank} of ${r.total}.`);
}

/** Title screen: the top few, or nothing at all when the board is empty or unreachable. */
export async function refreshTitleBoard(panel: LeaderboardPanel, nickname: string): Promise<void> {
  const top = await fetchTop(LEADERBOARD.titleRows);
  if (!top || top.entries.length === 0) {
    panel.root.style.display = 'none';
    return;
  }
  panel.setEntries(top.entries, LEADERBOARD.titleRows, nickname);
  panel.setStatus('');
  panel.root.style.display = 'block';
}
