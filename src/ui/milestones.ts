/** "a moon", "an asteroid". */
export function withArticle(name: string): string {
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

/** Milestone ladder line from the biggest object eaten, e.g. "You ate a moon". */
export function ladderLine(biggest: { name: string } | null): string {
  return biggest ? `You ate ${withArticle(biggest.name)}` : 'You ate nothing';
}
