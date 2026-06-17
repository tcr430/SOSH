// NFKC normalization collapses fullwidth characters, ligatures, and compatibility
// forms (e.g. ＡＢＣ → abc). It does NOT collapse cross-script lookalikes
// (e.g. Cyrillic 'а' vs Latin 'a') — that is a documented P2 escalation.
export function canonicalizeEmail(input: string): string {
  return input.normalize('NFKC').toLowerCase().trim()
}
