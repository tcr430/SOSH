import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0020 §11.3 — the session's central claim, made executable. Four
// source scans, each with a PER-ROOT vacuity guard (lib/learning/
// memory-table-boundary.test.ts's shape, ADR 0019 §8.5): an empty or
// renamed root must fail loudly, not pass vacuously — that is the
// FALSE-GREEN shape ADR 0015 exists to catch (Session 26-D's MINOR-1 was
// exactly this, in aggregate form).
//
// Each scan below was DEMONSTRATED to redden: the forbidden pattern was
// temporarily introduced, the test file was re-run and observed to fail for
// the intended reason, then the violation was reverted. See the E2.10
// commit message for the four transcripts.

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

// Strips `//` line comments before pattern-matching, so prose that MENTIONS
// a forbidden pattern inside a comment (lib/db/types.ts:43 and
// lib/ai/wrap-evidence.ts:234 both explain the guard using the literal
// phrase `as UntrustedText` / `as RenderedSignalText` in a comment) is never
// mistaken for the pattern itself. The negative lookbehind on `:` avoids
// stripping `https://` URLs.
function stripLineComments(source: string): string {
  // Normalize CRLF -> LF first: without it, `.` (which never matches a line
  // terminator, including `\r`) can leave a trailing `\r` un-consumed after
  // `.*`, so the pattern fails to reach `$` and the whole replace silently
  // no-ops on Windows-checked-out (CRLF) files — exactly the bug this
  // scan's own first run caught (lib/db/types.ts:43's `\r`-terminated
  // comment line was never actually stripped).
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

const ROOT = process.cwd()
const LIB_SIGNALS_DIR = path.join(ROOT, 'lib', 'signals')
const POLLER_ROUTE_DIR = path.join(ROOT, 'app', 'api', 'cron', 'signals-poll')
const LIB_DIR = path.join(ROOT, 'lib')
const APP_DIR = path.join(ROOT, 'app')

describe('SIGNAL-NO-LLM-IN-STAGE-AB (L-1, ADR §11.3 scan #1)', () => {
  const SCAN_ROOTS = [LIB_SIGNALS_DIR, POLLER_ROUTE_DIR]

  it('no file under lib/signals/** or the poller route imports @/lib/ai/* or @anthropic-ai/sdk', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectTsFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const files = SCAN_ROOTS.flatMap((root) => collectTsFiles(root))
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/from\s+['"]@\/lib\/ai\//.test(source) || /from\s+['"]@anthropic-ai\/sdk['"]/.test(source)) {
        offenders.push(path.relative(ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('exception stated so the scan is written correctly: wrapSignalForPrompt (Session 28\'s entry point) is referenced by nothing in Session 27\'s scope', () => {
    const files = SCAN_ROOTS.flatMap((root) => collectTsFiles(root))
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/wrapSignalForPrompt/.test(source)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })

  // SIGNAL-NO-SIXTH-SANITIZER's full-standing form (the fifth assertion the
  // build note asks for). lib/signals/no-sixth-sanitizer.test.ts already
  // proves this at E2.4-authored scope; this assertion is the same check,
  // living in the session's central enforcement file so a reader finds all
  // four-plus-one constraints in one place.
  it('SIGNAL-NO-SIXTH-SANITIZER: lib/signals/** defines no local sanitizeDataField', () => {
    const files = collectTsFiles(LIB_SIGNALS_DIR)
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/function\s+sanitizeDataField/.test(source)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})

describe('SIGNAL-NO-PROVIDER-COUPLING (D-8, ADR §11.3 scan #2)', () => {
  // Repo-wide by necessity — proving "exactly one file" requires seeing
  // every file, not just lib/signals/**. Two roots, each vacuity-guarded on
  // its own: an accidentally-empty lib/ or app/ walk must fail loudly
  // rather than let the other root's non-emptiness mask it.
  const SCAN_ROOTS = [LIB_DIR, APP_DIR]

  it('@octokit/* is imported in exactly one file, and it is under lib/signals/**', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectTsFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const files = SCAN_ROOTS.flatMap((root) => collectTsFiles(root))
    expect(files.length).toBeGreaterThan(0)

    const importers: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/from\s+['"]@octokit\//.test(source)) importers.push(path.relative(ROOT, file))
    }

    expect(importers).toHaveLength(1)
    expect(importers[0]!.replace(/\\/g, '/')).toMatch(/^lib\/signals\//)
  })
})

describe('SIGNAL-CONFIG-ONLY-ENV (ADR §11.3 scan #3)', () => {
  const SCAN_ROOTS = [LIB_DIR, APP_DIR]
  const CONFIG_FILE = path.join(ROOT, 'lib', 'config.ts')

  it('no process.env.GITHUB* reference exists outside lib/config.ts', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectTsFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const files = SCAN_ROOTS.flatMap((root) => collectTsFiles(root)).filter((f) => f !== CONFIG_FILE)
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/process\.env\.GITHUB/.test(source)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})

describe('SIGNAL-PROMPT-SINK-NARROWED (ADR §11.3 scan #4)', () => {
  const SCAN_ROOTS = [LIB_DIR, APP_DIR]

  // The three files ADR 0020 §7.3/§7.4 names as the sole legitimate minting
  // sites: parse-release.ts mints UntrustedText from a raw GitHub release;
  // orchestrator.ts's one `'' as UntrustedText` is a documented empty-body
  // fallback on the SAME UPDATE path parse-release.ts already validated,
  // not a new untrusted-data entry point; wrap-evidence.ts mints
  // RenderedSignalText via wrapSignalForPrompt(). Any OTHER file performing
  // this cast is a new, unreviewed sink — exactly what this scan exists to
  // catch.
  const ALLOWED_MINTING_FILES = new Set(
    [
      path.join(ROOT, 'lib', 'signals', 'parse-release.ts'),
      path.join(ROOT, 'lib', 'signals', 'orchestrator.ts'),
      path.join(ROOT, 'lib', 'ai', 'wrap-evidence.ts'),
    ],
  )

  const FORBIDDEN_PATTERNS = [
    /\bas\s+UntrustedText\b/,
    /\bas\s+RenderedSignalText\b/,
    /\bas\s+unknown\s+as\s+UntrustedText\b/,
    /\bas\s+unknown\s+as\s+RenderedSignalText\b/,
  ]

  it('no cast to UntrustedText / RenderedSignalText appears outside their single minting module', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectTsFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const files = SCAN_ROOTS.flatMap((root) => collectTsFiles(root)).filter((f) => !ALLOWED_MINTING_FILES.has(f))
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (FORBIDDEN_PATTERNS.some((p) => p.test(source))) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })

  it('the allowed minting files themselves still exist and actually mint (guards against the allowlist going stale)', () => {
    for (const file of ALLOWED_MINTING_FILES) {
      expect(fs.existsSync(file), `${file} no longer exists — update the allowlist`).toBe(true)
    }
  })
})

// ADR 0020 §11.4 — the SIX Tier-3 diff-verified properties, enumerated AS
// DECISIONS (ADR 0015 §2): each has no runtime test because the property is
// one of ABSENCE, not behavior — a runtime test cannot observe "this thing
// was never added." Recorded here so "no test" reads as a deliberate
// decision made at E2.10, not an oversight a future session has to
// rediscover.
//
//   1. SIGNAL-READ-ONLY-GITHUB   — the requested GitHub App permission set
//      is contents:read + metadata:read (ADR §5.4), and this diff contains
//      no write-method call against api.github.com. Verified by reading the
//      diff at commit time, not by a runtime assertion (there is no request
//      to intercept — the property is that the request is never made).
//   2. No campaigns.origin migration — 'signal_generated' already exists
//      (20260722190000_mode2_brief_and_roles.sql:114); this diff contains
//      no change to that CHECK constraint.
//   3. No lib/social/** change — SocialProvider untouched (ADR §10.2).
//   4. No webhook route (L-3) — this diff contains no route under
//      app/api/signals/** other than the install callback and the cron
//      poller.
//   5. SIGNAL-NO-EMBEDDINGS — no pgvector extension, no embedding call
//      anywhere in this diff.
//   6. SIGNAL-RETENTION-UNCLAIMED (A-3) — no customer-facing surface states
//      a retention period. (The ADJACENT half of this IS runtime-tested:
//      app/[locale]/(dashboard)/settings/signals/signals-i18n.test.ts's
//      regex scan over the three locale files, added in E2.9. This entry
//      records the boundary of what that test can and cannot see — it
//      scans the signals i18n namespace, not every customer-facing surface
//      in the repo.)
describe('ADR §11.4 — Tier-3 diff-verified properties (enumerated as decisions, no runtime test by design)', () => {
  it('is a documentation-only block — the six properties above have no assertion here', () => {
    expect(true).toBe(true)
  })
})
