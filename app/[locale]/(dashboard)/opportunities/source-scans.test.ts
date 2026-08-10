import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0021 §7.6/§5.6/§9.3 (Session 28 E5.9) — SIGNAL3-NEVER-AUTONOMOUS
// (render posture) and the no-publishing-path-import half of
// SIGNAL3-NEVER-AUTONOMOUS, made executable. Per-root vacuity guarded
// (ADR 0015 §1(c)): an accidentally-empty or renamed surface dir must fail
// loudly, not pass vacuously.

function stripLineComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

const ROOT = process.cwd()
const OPPORTUNITIES_DIR = path.join(
  ROOT,
  'app',
  '[locale]',
  '(dashboard)',
  'opportunities',
)

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

describe('SIGNAL3-NEVER-AUTONOMOUS render posture (ADR 0021 §7.6) — no dangerouslySetInnerHTML', () => {
  it('no file under the opportunities surface uses dangerouslySetInnerHTML', () => {
    const files = collectSourceFiles(OPPORTUNITIES_DIR)
    expect(files.length, `${OPPORTUNITIES_DIR} contributed zero files to the scan`).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/dangerouslySetInnerHTML/.test(source)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})

describe('SIGNAL3-NEVER-AUTONOMOUS diff posture (ADR 0021 §5.6, Session 28 E5.11) — no publishing-path import anywhere on the Mode 3 surface', () => {
  // "The feed proposes. It never posts." — no Mode 3 code path imports the
  // publishing path (lib/social/**, or any posts-write helper). TWO roots,
  // EACH per-root vacuity guarded (Session 26-D MINOR-1: a combined-length
  // guard alone can't prove a second root actually contributed files) —
  // the UI surface (this directory) AND lib/signals/** (Stage B/C/D/the
  // orchestrator), since "the feed" is not the whole of "Mode 3."
  const SCAN_ROOTS = [OPPORTUNITIES_DIR, path.join(ROOT, 'lib', 'signals')]
  const PUBLISHING_IMPORT_PATTERN = /from ['"]@\/lib\/social/

  it('no file under the opportunities surface or lib/signals/** imports lib/social/**', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectSourceFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const files = SCAN_ROOTS.flatMap(root => collectSourceFiles(root))
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (PUBLISHING_IMPORT_PATTERN.test(source)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })

  it('no file under the opportunities surface writes to the posts table', () => {
    const files = collectSourceFiles(OPPORTUNITIES_DIR)
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/from\(['"]posts['"]\)/.test(source)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})
