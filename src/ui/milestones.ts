/** "a moon", "an asteroid". */
export function withArticle(name: string): string {
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

/** Milestone ladder line from the biggest meal, e.g. "You ate a moon", or "You ate Kerr-7" when it was another hole. */
export function ladderLine(biggest: { name: string; hole?: boolean } | null): string {
  if (!biggest) return 'You ate nothing';
  return biggest.hole ? `You ate ${biggest.name}` : `You ate ${withArticle(biggest.name)}`;
}
