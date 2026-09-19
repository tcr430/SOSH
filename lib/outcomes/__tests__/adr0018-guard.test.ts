import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ADR0018_BASE_SHA,
  ADR0018_WATCHED_MIGRATIONS,
  ADR0018_WATCHED_PATHS,
  evaluateAdr0018Diff,
} from '../adr0018-guard'

// OUTCOME-ADR0018-UNCHANGED (ADR 0026 §12.3, constraint 29). The git half runs as
// the recorded Tier-3 command scripts/check-adr0018-unchanged.ts (it needs the
// BASE commit, which a shallow CI checkout may lack); THIS file proves the
// decision logic, and that the watched set cannot silently become empty.

const ROOT = process.cwd()

describe('evaluateAdr0018Diff — the decision logic', () => {
  it('no changed path is OK', () => {
    expect(evaluateAdr0018Diff([])).toEqual({ ok: true, offenders: [] })
    expect(evaluateAdr0018Diff(['', '  ', '\n'])).toEqual({ ok: true, offenders: [] })
  })

  it('a whitespace edit in lib/learning/promote.ts (planted) is a failure that names the file', () => {
    expect(evaluateAdr0018Diff(['lib/learning/promote.ts\n'])).toEqual({ ok: false, offenders: ['lib/learning/promote.ts'] })
  })

  it('a changed ADR 0018 migration is a failure', () => {
    const verdict = evaluateAdr0018Diff(['supabase/migrations/20260726010000_learning_capture.sql'])
    expect(verdict.ok).toBe(false)
  })

  it('normalises Windows separators, de-duplicates and sorts', () => {
    const verdict = evaluateAdr0018Diff(['lib\\learning\\b.ts', 'lib/learning/a.ts', 'lib/learning/a.ts'])
    expect(verdict.offenders).toEqual(['lib/learning/a.ts', 'lib/learning/b.ts'])
  })
})

describe('the watched set is real (the check cannot pass vacuously)', () => {
  it('BASE is a full 40-char commit SHA', () => {
    expect(ADR0018_BASE_SHA).toMatch(/^[0-9a-f]{40}$/)
  })

  it('lib/learning/ exists and is non-empty', () => {
    const files = fs.readdirSync(path.join(ROOT, 'lib', 'learning'))
    expect(files.length).toBeGreaterThan(5)
  })

  it('every watched ADR 0018 migration exists on disk (a rename would otherwise blind the check)', () => {
    expect(ADR0018_WATCHED_MIGRATIONS).toHaveLength(8)
    for (const rel of ADR0018_WATCHED_MIGRATIONS) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} does not exist`).toBe(true)
    }
    expect(ADR0018_WATCHED_PATHS[0]).toBe('lib/learning/')
    expect(ADR0018_WATCHED_PATHS).toHaveLength(9)
  })
})
