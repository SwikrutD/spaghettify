// Anonymous, cookieless analytics through Umami (https://umami.is), same setup as Rex Chase.
// Loads only on the live site and fails silently when blocked or offline, so the game never waits on it.
// No personal data: no IDs and nothing the player types (the nickname is never sent).
import { ANALYTICS } from '../config';

type Umami = { track: (name: string, data?: Record<string, string | number | boolean>) => void };

let loaded = false;

export function initAnalytics(): void {
  if (loaded || !ANALYTICS.websiteId) return;
  if (!import.meta.env.PROD || !location.protocol.startsWith('http')) return;
  if (!(ANALYTICS.domains as readonly string[]).includes(location.hostname)) return;
  loaded = true;
  const s = document.createElement('script');
  s.defer = true;
  s.src = ANALYTICS.src;
  s.dataset.websiteId = ANALYTICS.websiteId;
  s.dataset.domains = ANALYTICS.domains.join(',');
  document.head.appendChild(s);
}

/** Send a custom event. Safe to call anywhere; does nothing if Umami is not loaded. */
export function track(name: string, data?: Record<string, string | number | boolean>): void {
  try {
    const umami = (window as unknown as { umami?: Umami }).umami;
    if (loaded && umami && typeof umami.track === 'function') umami.track(name, data);
  } catch {
    /* analytics must never break the game */
  }
}

/** Group scores so reports read as a distribution rather than thousands of distinct values. */
export function scoreBand(score: number): string {
  const edges = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
  for (let i = 0; i < edges.length; i++) if (score < edges[i]) return `${i ? edges[i - 1] : 0}-${edges[i] - 1}`;
  return `${edges[edges.length - 1]}+`;
}
