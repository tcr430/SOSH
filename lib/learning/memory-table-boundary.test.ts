import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

// [Session 25-D correction, MINOR-2] ADR 0018 §13's LEARN-MEMORY-THROUGH-
// BOUNDARY and LEARN-VOICE-NOT-AUTO-MUTATED are true today — but only by
// grep. promote.test.ts and orchestrator.test.ts mock
// lib/db/memory-performance.ts's exports, so a direct
// `.from('performance_memory')` (or 'post_ai_originals' / 'post_edit_signals')
// added anywhere in lib/learning/**, or a `.from('brand_voices'...)` added to
// bypass the deliberate no-voice-table design, would pass every existing
// test silently. Same technique as classify.test.ts's LEARN-HEURISTIC-FIRST
// source scan: read the real source files and assert the forbidden pattern
// is absent, so a future violation reddens CI instead of waiting for a
// reviewer's grep.

const SCAN_ROOTS = [
  path.join(__dirname), // lib/learning/**
  path.join(__dirname, '..', '..', 'app', 'api', 'cron', 'capture-learning'), // the one route this track added
]

const FORBIDDEN_TABLE_PATTERN =
  /\.from\(\s*['"](performance_memory|post_ai_originals|post_edit_signals|brand_voice\w*)['"]/

function collectNonTestTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectNonTestTsFiles(fullPath))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

describe('LEARN-MEMORY-THROUGH-BOUNDARY / LEARN-VOICE-NOT-AUTO-MUTATED (Tier-2 source scan)', () => {
  it('no file under lib/learning/** or app/api/cron/capture-learning/** queries performance_memory, post_ai_originals, post_edit_signals, or any brand_voice* table directly', () => {
    const files = SCAN_ROOTS.flatMap((root) => collectNonTestTsFiles(root))
    // Guards the scan itself: if this ever finds zero files, the test would
    // pass vacuously — a false green exactly like the FALSE-GREEN shape
    // ADR 0015 exists to catch.
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      if (FORBIDDEN_TABLE_PATTERN.test(source)) {
        offenders.push(path.relative(process.cwd(), file))
      }
    }
    expect(offenders).toEqual([])
  })
})
