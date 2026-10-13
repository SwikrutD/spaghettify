// Leaderboard rules shared by the game and the server (server/ imports this file directly and runs it
// with Node's type stripping), so: no DOM, erasable TypeScript only and `.ts` import extensions.
import { GROWTH, HOLES, HUNGER, LEADERBOARD, MENU, MILESTONES, PLAYER } from '../config/index.ts';
import { MILESTONE_MASSES } from '../sim/milestones.ts';

/** What the game submits at the end of a life. */
export interface RunSubmission {
  nickname: string;
  /** Peak mass gained over the start mass, in points (see HUNGER.pointsPerMass). */
  score: number;
  /** Highest size milestone reached, 1-based as shown to the player (the field keeps its old name). */
  tier: number;
  seconds: number;
  eaten: number;
  /** Other holes swallowed (each adds HOLES.scorePerHole to the score). */
  holes: number;
  /** Posted by the game itself from an offline arena (bots only), not scored by the server. */
  offline: boolean;
}

/** Keep letters, digits, spaces and a few separators; trim and cap the length. */
export function cleanNickname(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MENU.nicknameMaxLength);
}

// Light profanity filter. Names are folded (case, accents, look-alike digits and symbols, separators,
// repeated letters) before matching. Stems match anywhere in the folded name; short words that hide
// inside ordinary words ("class", "Scunthorpe") match only as a whole word of the original name.
const BLOCKED_STEMS = [
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'nigg', 'niga', 'faggot', 'retard', 'nazi', 'hitler',
  'penis', 'vagina', 'pussy', 'dildo', 'porn', 'wank', 'twat', 'bastard', 'asshole', 'motherf', 'jizz', 'tranny',
];
const BLOCKED_WORDS = [
  'ass', 'arse', 'cum', 'fag', 'fags', 'tit', 'tits', 'dick', 'cock', 'sex', 'hoe', 'nig', 'coon', 'gook', 'homo',
  'fuk', 'rape', 'raped', 'rapist', 'pedo', 'kkk', 'spic', 'chink', 'kike',
];
/** Ordinary words that contain a stem; removed before matching. */
const ALLOWED = ['scunthorpe', 'shiitake'];

const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '$': 's', '@': 'a', '!': 'i' };

function fold(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0-9$@!]/g, (c) => LOOKALIKE[c] ?? c);
}

export function isProfane(raw: string): boolean {
  let folded = fold(raw);
  for (const ok of ALLOWED) folded = folded.split(ok).join(' ');
  const squashed = folded.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
  // Stems are compared squashed too, so "fuuuck" and "f.u.c.k" both hit "fuck".
  if (BLOCKED_STEMS.some((stem) => squashed.includes(stem.replace(/(.)\1+/g, '$1')))) return true;
  const words = folded.split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => BLOCKED_WORDS.includes(w) || BLOCKED_WORDS.includes(w.replace(/(.)\1+/g, '$1')));
}

const START_MASS = GROWTH.massDensity * Math.pow(PLAYER.startRadius, GROWTH.massExponent);

/** Highest score a life of this length (with this many holes swallowed) can plausibly reach: the start mass doubled every few seconds, up to a cap, plus the hole bonus. */
export function maxScore(seconds: number, holes = 0): number {
  const doublings = Math.min(seconds / LEADERBOARD.doublingSeconds, 60);
  const peak = Math.min(LEADERBOARD.maxPeakMass, START_MASS * Math.pow(2, doublings));
  return Math.ceil(HUNGER.pointsPerMass * (peak - START_MASS)) + holes * HOLES.scorePerHole;
}

/** Lowest score that can have reached this milestone (1-based): its mass, over the start mass. */
export function minScore(milestone: number): number {
  const needed = Math.max(0, MILESTONE_MASSES[milestone - 1] - START_MASS);
  return Math.floor(HUNGER.pointsPerMass * needed * (1 - LEADERBOARD.thresholdTolerance));
}

export type RunCheck = { ok: true; run: RunSubmission } | { ok: false; reason: 'invalid' | 'nickname' | 'implausible' };

/**
 * Validate and normalise a submission. 'invalid' is a malformed request, 'nickname' an empty or
 * blocked name, 'implausible' a run the sanity caps reject.
 */
export function checkRun(input: unknown): RunCheck {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'invalid' };
  const r = input as Record<string, unknown>;
  const { nickname, score, tier, seconds, eaten } = r;
  const holes = r.holes ?? 0;
  const offline = r.offline ?? false;
  if (typeof nickname !== 'string' || nickname.length > 64) return { ok: false, reason: 'invalid' };
  if (!Number.isSafeInteger(score) || (score as number) < 0) return { ok: false, reason: 'invalid' };
  if (!Number.isInteger(tier) || (tier as number) < 1 || (tier as number) > MILESTONES.length) return { ok: false, reason: 'invalid' };
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return { ok: false, reason: 'invalid' };
  if (!Number.isSafeInteger(eaten) || (eaten as number) < 0) return { ok: false, reason: 'invalid' };

  if (!Number.isSafeInteger(holes) || (holes as number) < 0) return { ok: false, reason: 'invalid' };
  if (typeof offline !== 'boolean') return { ok: false, reason: 'invalid' };

  const name = cleanNickname(nickname);
  if (!name || isProfane(name)) return { ok: false, reason: 'nickname' };

  const run: RunSubmission = { nickname: name, score: score as number, tier: tier as number, seconds, eaten: eaten as number, holes: holes as number, offline };
  if (run.seconds < LEADERBOARD.minSeconds || run.seconds > LEADERBOARD.maxSeconds) return { ok: false, reason: 'implausible' };
  if (run.eaten > LEADERBOARD.maxEatenPerSecond * run.seconds + LEADERBOARD.mealSlack) return { ok: false, reason: 'implausible' };
  if (run.holes > LEADERBOARD.maxHolesPerSecond * run.seconds + LEADERBOARD.holeSlack) return { ok: false, reason: 'implausible' };
  if (run.score > maxScore(run.seconds, run.holes)) return { ok: false, reason: 'implausible' };
  if (run.score < minScore(run.tier)) return { ok: false, reason: 'implausible' };
  return { ok: true, run };
}
