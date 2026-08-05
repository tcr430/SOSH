import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ADR 0020 §7.4/§11.3 scan #4 (SIGNAL-NO-SIXTH-SANITIZER) — five weak local
// `sanitizeDataField` copies already exist (brief.ts:13, rubric.ts:9,
// post-generation.ts:7, post-regeneration.ts:8,
// formats/native-generation-prompt.ts:9), documented accepted debt
// (ADR 0018 §15), not a pattern to extend. This is the scoped, THIS-SESSION
// half of that guarantee: no new copy under lib/signals/** and none in the
// new wrapSignalForPrompt function. E2.10 promotes this into the full
// standing source scan across the whole repo, with its own per-root vacuity
// guard (ADR §11.3) — this test only proves the surface E2.4 itself added.

function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__fixtures__' || entry === 'node_modules') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      out.push(...collectTsFiles(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('SIGNAL-NO-SIXTH-SANITIZER (ADR 0020 §7.4, this-session scope)', () => {
  it('lib/signals/** defines no sanitizeDataField function', () => {
    const dir = join(process.cwd(), 'lib', 'signals')
    const files = collectTsFiles(dir)
    expect(files.length).toBeGreaterThan(0) // per-root vacuity guard

    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      expect(content, `${file} must not define a local sanitizeDataField`).not.toMatch(/function\s+sanitizeDataField/)
    }
  })

  it('lib/ai/wrap-evidence.ts defines no sanitizeDataField function — it reuses neutralizeWithSentinels', () => {
    const file = join(process.cwd(), 'lib', 'ai', 'wrap-evidence.ts')
    const content = readFileSync(file, 'utf8')
    expect(content).not.toMatch(/function\s+sanitizeDataField/)
    expect(content).toContain('neutralizeWithSentinels')
  })
})
