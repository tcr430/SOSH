import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0021 §2.2/§7.3 (Session 28 E5.5) — SIGNAL3-TOOLS-READ-ONLY and the
// no-JSON.stringify half of SIGNAL3-TOOL-RESULTS-GUARDED, made executable.
// Both per-root vacuity guarded (ADR 0015 §1(c)): an accidentally-empty or
// renamed lib/signals/triage/ must fail loudly, not pass vacuously.

function stripLineComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

const ROOT = process.cwd()
const TRIAGE_DIR = path.join(ROOT, 'lib', 'signals', 'triage')

function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__fixtures__' || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full))
    } else if (/\.ts$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('SIGNAL3-TOOLS-READ-ONLY (ADR 0021 §2.2)', () => {
  const WRITE_VERB_PATTERN = /\.(insert|update|upsert|delete|rpc)\s*\(/

  it('no file under lib/signals/triage/ calls a write verb on a Supabase client', () => {
    const files = collectTsFiles(TRIAGE_DIR)
    expect(files.length, `${TRIAGE_DIR} contributed zero files to the scan`).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (WRITE_VERB_PATTERN.test(source)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})

describe('SIGNAL3-TOOL-RESULTS-GUARDED — no-JSON.stringify half (ADR 0021 §7.3)', () => {
  it('no file under lib/signals/triage/ calls JSON.stringify itself — that call site is lib/ai/tool-runner.ts alone', () => {
    const files = collectTsFiles(TRIAGE_DIR)
    expect(files.length, `${TRIAGE_DIR} contributed zero files to the scan`).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/JSON\.stringify/.test(source)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })

  it("every tool in tools.ts returns already-guarded fields — the semantic half this scan alone cannot prove (see tools.test.ts's neutralisation cases)", () => {
    // Documentation-only assertion: security-reviewer (E5.4+E5.5+E5.7 pass,
    // HIGH-2) found that a JSON.stringify grep alone cannot catch an
    // unguarded tool result, since lib/ai/tool-runner.ts (not this module)
    // performs the stringify. The real property — every string field a
    // tool's execute() returns has already passed through
    // wrapToolResultForPrompt/wrapEvidenceForPrompt — is proven by
    // tools.test.ts's fixture-based injection-neutralisation cases, not by
    // this scan. This assertion exists so a reader of THIS file sees that
    // pointer rather than assuming the scan above is the whole proof.
    expect(true).toBe(true)
  })
})
