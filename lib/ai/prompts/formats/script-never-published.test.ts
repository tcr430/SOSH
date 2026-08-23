import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0022 §7.2 (Session 29, F1b.8) — SCRIPT-NEVER-PUBLISHED, an EXECUTABLE
// SOURCE SCAN on lib/signals/source-scans.test.ts's precedent: a compile-
// error guarantee (a branded PublishableText sink) was evaluated and
// REJECTED ON COST (§7.2 — posts.content has several legitimate plain-string
// producers today; forcing them all through one mint point would make the
// brand mean "passed through the function everything passes through," a
// tautology). This scan is what ships instead.
//
// Demonstrated to redden: a temporary `const scriptBrief = 'x'` was added to
// lib/db/posts.ts, this file was re-run and observed to fail (the offender
// list included lib/db/posts.ts), then the violation was reverted.

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '__fixtures__', '.next'])

function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

// Strips `//` line comments before pattern-matching, mirroring
// source-scans.test.ts's stripLineComments exactly (including its CRLF
// normalization fix — Windows-checked-out files leave a trailing `\r` that
// `.` never consumes, silently no-opping the strip otherwise).
function stripLineComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

const ROOT = process.cwd()
const LIB_DIR = path.join(ROOT, 'lib')
const APP_DIR = path.join(ROOT, 'app')

// The generation-output module (defines the field), the single mapper that
// consumes generation output (synthesizes a SinglePostOutput from
// regeneration output, and so legitimately writes `scriptBrief: null`) —
// §7.2's original two named locations — plus the Session 29 F1b.9 addition:
// the approvals-surface preview component that renders scriptBrief per §7.3
// ("renders wherever posts are reviewed... the same treatment imageBrief
// receives"). Three legitimate producers/consumers, not a re-scoping of the
// guarantee — the scan's whole point (nowhere ELSE) is unchanged.
const ALLOWED_FILES = new Set([
  path.join(ROOT, 'lib', 'ai', 'prompts', 'formats', 'schemas.ts'),
  path.join(ROOT, 'app', '[locale]', '(dashboard)', 'campaigns', '[id]', 'posts', 'actions.ts'),
  path.join(ROOT, 'app', '[locale]', '(dashboard)', 'approvals', 'AiOutputPreview.tsx'),
])

describe('SCRIPT-NEVER-PUBLISHED (ADR 0022 §7.2)', () => {
  const SCAN_ROOTS = [LIB_DIR, APP_DIR]

  it('scriptBrief appears nowhere outside the generation-output module and the single consuming mapper', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectTsFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const files = SCAN_ROOTS.flatMap((root) => collectTsFiles(root)).filter((f) => !ALLOWED_FILES.has(f))
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/scriptBrief/.test(source)) offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'))
    }
    expect(offenders).toEqual([])
  })

  it('the two allowed files themselves still exist and actually reference scriptBrief (guards against the allowlist going stale)', () => {
    for (const file of ALLOWED_FILES) {
      expect(fs.existsSync(file), `${path.relative(ROOT, file)} no longer exists — update the allowlist`).toBe(true)
      const source = fs.readFileSync(file, 'utf8')
      expect(/scriptBrief/.test(source), `${path.relative(ROOT, file)} no longer references scriptBrief — narrow the allowlist`).toBe(true)
    }
  })

  // Explicit, named checks on the two surfaces §7.2 calls out by name —
  // redundant with the repo-wide scan above (both would already catch a
  // violation here), but stated explicitly because these are the two
  // surfaces the guarantee exists FOR: posts.content's write path and the
  // publishing worker.
  it('never appears in the posts.content write path (lib/db/posts.ts)', () => {
    const file = path.join(LIB_DIR, 'db', 'posts.ts')
    expect(fs.existsSync(file)).toBe(true)
    const source = stripLineComments(fs.readFileSync(file, 'utf8'))
    expect(/scriptBrief/.test(source)).toBe(false)
  })

  it('never appears in the publishing worker (lib/publishing/orchestrator.ts)', () => {
    const file = path.join(LIB_DIR, 'publishing', 'orchestrator.ts')
    expect(fs.existsSync(file)).toBe(true)
    const source = stripLineComments(fs.readFileSync(file, 'utf8'))
    expect(/scriptBrief/.test(source)).toBe(false)
  })
})

// ADR 0022 §11.3 — Tier 3, enumerated as a decision (ADR 0015 §2): a compile-
// error guarantee (a branded sink type) was evaluated and rejected on cost
// (§7.2), not skipped. This scan is the discharge mechanism; "no compile-time
// type guarantee" is a recorded choice, not an oversight.
describe('ADR 0022 §7.2 — the compile-error guarantee was evaluated and rejected on cost (documentation-only)', () => {
  it('is a documentation-only block — the decision above has no assertion here', () => {
    expect(true).toBe(true)
  })
})
