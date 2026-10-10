// ADR 0026 §5: a performance_memory outcome row's `pattern_key` is `outcome:<dimension>:<value>:<direction>:<platform>`
// (no component contains a colon). It is the row's IDENTITY; `pattern` is a rendered English sentence and is never
// reinterpreted. PURE: shared by the campaign page (lib/outcomes/campaign-view.ts) and the analytics report, so the two can
// never parse a cell differently (Session 37-D D2).

export interface PatternKeyParts {
  dimension: string
  value: string
  direction: string
  platform: string
}

export function parsePatternKey(key: string | null): PatternKeyParts | null {
  if (!key) return null
  const [kind, dimension, value, direction, platform] = key.split(':')
  if (kind !== 'outcome' || !dimension || !value || !direction || !platform) return null
  return { dimension, value, direction, platform }
}
