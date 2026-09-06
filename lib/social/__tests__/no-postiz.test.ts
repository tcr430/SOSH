import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// SOCIAL-NO-POSTIZ (ADR 0028 §8.4, L-3, N2.11). Greps the repository
// case-insensitively for 'postiz'. The removal must be TOTAL and provable,
// not asserted — launch-checklist.md §16's last row made executable. A
// scan that has never been shown to fail is not a scan: demonstrated to
// redden this step by reintroducing a single reference, confirmed the
// failure named the exact file, then reverted (see the N2.11 commit
// message for the transcript).
//
// Exemptions, each with its own stated reason — no exemption is silent:
//
// - docs/decisions/  : historical ADRs. Rewriting a past decision record
//   to erase what was actually decided (Postiz WAS the ADR 0002 broker)
//   would falsify the record — the same reasoning CLAUDE.md's
//   REVIEWER-REPORT APPEND-ONLY rule applies to reviewer findings.
// - docs/reviews/     : immutable review history, same reasoning.
// - docs/build-guide/ : historical session build guides, INCLUDING this
//   session's own (session-30-5.md), which quotes "Postiz" extensively as
//   part of the instructions directing this very removal. A build guide
//   records what a session was asked to do and found, at the time —
//   rewriting it after the fact has the same falsification problem as
//   docs/decisions/ and docs/reviews/. (N2.0's original ruling on this
//   directory is superseded by this restatement, made explicit here
//   rather than assumed carried over.)
// - supabase/migrations/ : applied migrations are immutable historical
//   record of what actually ran against the live database — this
//   session's own N2.3/N2.4 migrations narrate why they were needed,
//   citing the broker's exact defect (D-alpha, D-gamma). Editing an
//   applied migration's comments after the fact is the same class of
//   falsification as rewriting an ADR. Not one of N2.0's original four
//   classifications (these migrations did not exist until N2.3, after
//   N2.0 ran) — found and ruled on fresh in this step, exactly what
//   "N2.0's classified surface is incomplete" anticipates.
// - docs/brainstorm/archive/ : frozen ideation archive, same historical-
//   record reasoning as docs/decisions/ and docs/reviews/. Also found
//   fresh in this step (not one of N2.0's four classifications).
// - docs/evidence/ : counsel-facing evidence packs follow the SAME
//   append-only amendment form as ADRs (docs/evidence/0010-legal-
//   evidence.md's own Amendment A1, and this step's Amendment A2 —
//   confirmed by reading the file before ruling on it). Rewriting
//   Amendment A1's original "Postiz WIP" text would falsify what was
//   true in 2026-06-13, exactly as rewriting an ADR would. Also found
//   fresh in this step.
// - this scan file itself, which names "postiz" throughout this comment
//   to explain the constraint it enforces.
// - lib/observability/csp.test.ts : SOCIAL-CSP-NO-POSTIZ-HOST is itself a
//   scan-style constraint (asserts connect-src no longer contains the
//   broker's host) — its name and assertion string necessarily contain
//   "postiz" to say what is now absent. Same class as this file being
//   self-exempt.
// - lib/social/__tests__/eslint-internals-ban.test.ts : proves the
//   SOCIAL_INTERNALS_BAN entry for postiz-provider was REPLACED, not
//   silently dropped (a dropped entry would look identical to a replaced
//   one from the lint config alone) — the test has to name the exact
//   deleted import path to assert the ban no longer fires for it.
// - app/[locale]/(dashboard)/settings/accounts/accounts-i18n.test.ts :
//   SOCIAL-I18N-NO-BROKER-KEY, same shape as the CSP test above — it
//   proves the i18n key `postiz_unavailable` is gone, which requires
//   writing that exact key literally.
// - docs/current-phase.md : an append-only session log (same reasoning
//   as docs/decisions/ and docs/reviews/, restated explicitly here
//   rather than assumed carried over) — its historical entries, e.g.
//   Session 3D's and Session 6B's, are the true record of what those
//   sessions actually did with Postiz and are not rewritten after the
//   fact. This step appends a new entry recording the removal; it does
//   not touch the old ones.
// - docs/launch-checklist.md : §16 is the operational checklist that
//   narrates *this specific removal*, including this scan's own
//   exemption list — self-referential in the same way this scan file's
//   own comment is. Its checked-off rows describe what was removed and
//   necessarily name what was removed to say so.
// - docs/backlog.md : the 22E-integration-discovery row (N2.13) narrates
//   that lib/social/__integration__/ does not exist because Postiz's
//   integration suite was deleted whole and no native replacement was
//   written — same historical-narration reasoning as launch-checklist.md
//   §16 immediately above.
const ROOT = process.cwd()
const SELF = path.join(__dirname, 'no-postiz.test.ts')

const EXEMPTED_ROOTS = [
  path.join(ROOT, 'docs', 'decisions'),
  path.join(ROOT, 'docs', 'reviews'),
  path.join(ROOT, 'docs', 'build-guide'),
  path.join(ROOT, 'docs', 'brainstorm', 'archive'),
  path.join(ROOT, 'docs', 'evidence'),
  path.join(ROOT, 'supabase', 'migrations'),
]

const EXEMPTED_FILES = [
  path.join(ROOT, 'lib', 'observability', 'csp.test.ts'),
  path.join(ROOT, 'lib', 'social', '__tests__', 'eslint-internals-ban.test.ts'),
  path.join(ROOT, 'app', '[locale]', '(dashboard)', 'settings', 'accounts', 'accounts-i18n.test.ts'),
  path.join(ROOT, 'docs', 'current-phase.md'),
  path.join(ROOT, 'docs', 'launch-checklist.md'),
  path.join(ROOT, 'docs', 'backlog.md'),
]

function isExempted(filePath: string): boolean {
  if (filePath === SELF) return true
  if (EXEMPTED_FILES.includes(filePath)) return true
  return EXEMPTED_ROOTS.some((root) => filePath === root || filePath.startsWith(root + path.sep))
}

// MINOR-4 (Session 30.5-D, D5): '__fixtures__' was excluded here alongside
// node_modules/.git/.next, but unlike those three it IS source — a scan
// whose own comment above promises "no exemption is silent" had a silent
// one. Removed: the walk now sees fixture directories like any other.
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', '.next'])

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

// Scoped to the real source tree — mirrors the SCAN_ROOTS convention used
// by every other scan in this repo (lib/signals/source-scans.test.ts).
// Walking node_modules/lockfiles/binary assets would be slow and pointless;
// these are every directory and standalone file where a "postiz" reference
// would actually matter.
const SCAN_DIRS = ['lib', 'app', 'components', 'i18n', 'docs', 'supabase', 'scripts']
  .map((d) => path.join(ROOT, d))
  .filter((d) => fs.existsSync(d))
const SCAN_FILES = [
  'package.json',
  'eslint.config.mjs',
  'CLAUDE.md',
  'proxy.ts',
  'vitest.config.ts',
  'vitest.integration.config.ts',
  '.env.local.example',
]
  .map((f) => path.join(ROOT, f))
  .filter((f) => fs.existsSync(f))

describe('SOCIAL-NO-POSTIZ (ADR 0028 §8.4, L-3)', () => {
  it('no "postiz" reference exists anywhere in the source tree outside the stated exemptions', () => {
    for (const dir of SCAN_DIRS) {
      expect(collectFiles(dir).length, `${dir} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const files = [...SCAN_DIRS.flatMap((d) => collectFiles(d)), ...SCAN_FILES].filter((f) => !isExempted(f))
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      let content: string
      try {
        content = fs.readFileSync(file, 'utf8')
      } catch {
        continue
      }
      if (/postiz/i.test(content)) {
        offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })

  it('the exempted roots and files still exist (guards against this scan silently passing because a path was renamed)', () => {
    for (const root of EXEMPTED_ROOTS) {
      expect(fs.existsSync(root), `${path.relative(ROOT, root)} no longer exists — update EXEMPTED_ROOTS`).toBe(true)
    }
    for (const file of EXEMPTED_FILES) {
      expect(fs.existsSync(file), `${path.relative(ROOT, file)} no longer exists — update EXEMPTED_FILES`).toBe(true)
    }
  })
})
