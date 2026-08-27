import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// ADR 0022 §11.3 (Session 29, F1b.11) — the four scope tripwires the F1b.11
// build step names, EXECUTABLE rather than advisory ("a scope rule that
// lives as prose is not enforced"). Each has a per-root vacuity guard
// (Session 26-D MINOR-1 precedent — lib/signals/source-scans.test.ts,
// lib/ai/prompts/formats/script-never-published.test.ts) so an empty scan
// root cannot pass silently.
//
// Each was demonstrated to redden against a temporary violation, then
// reverted, before this file was committed:
// - MODE2-RUNNER-UNTOUCHED: appended a blank line to lib/ai/runner.ts,
//   re-ran, observed the hash-pin assertion fail, reverted.
// - MODE2-CAROUSEL-NO-IMAGE-GEN: temporarily added a literal
//   `images.generate(` call to a scratch file under lib/, re-ran, observed
//   the offender list include it, reverted (file deleted).
// - POSTS-DDL-UNMODIFIED: temporarily added `ALTER TABLE posts ADD COLUMN
//   scratch_col text;` to F1b.2's migration file, re-ran, observed the
//   offender list include it, reverted.
// - MODE3-UNTOUCHED: appended a blank line to lib/signals/score.ts, re-ran,
//   observed the combined-hash assertion fail, reverted.

const ROOT = process.cwd()

function stripLineComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

// No .gitattributes in this repo — Windows checkouts (core.autocrlf=true)
// normalize LF->CRLF on disk while Linux CI checkouts keep LF, so a raw-byte
// hash of file content is NOT stable across environments. Every hash-pinned
// scan below reads through this so the pin is a property of the CONTENT,
// not of which OS checked it out.
function readNormalized(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
}

function collectTsFiles(dir: string, excludeDirNames = new Set(['node_modules', '__fixtures__', '.next'])): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excludeDirNames.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full, excludeDirNames))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// MODE2-RUNNER-UNTOUCHED (ADR 0022 §6.5, §11.3 "RUNNER-UNMODIFIED")
// ─────────────────────────────────────────────────────────────────────────
// lib/ai/runner.ts is byte-identical across the whole Session 29 Track F
// range (`git diff d3e6c27e~1..HEAD -- lib/ai/runner.ts` is empty — verified
// at F1b.11's own range head). A git-diff-against-a-base-SHA check is not a
// durable STANDING test (the base SHA is a point in this session's history,
// not a property of the file going forward) — a frozen content hash is,
// mirroring MODE2-PROMPT-BYTE-IDENTICAL's frozen-fixture precedent (F1b.7):
// any future edit reddens this test immediately, from here forward.

describe('MODE2-RUNNER-UNTOUCHED (ADR 0022 §6.5/§11.3 RUNNER-UNMODIFIED)', () => {
  const RUNNER_PATH = path.join(ROOT, 'lib', 'ai', 'runner.ts')
  // Frozen at Session 29 F1b.11 (commit range d3e6c27e..a038678d) — the exact
  // SHA-256 of lib/ai/runner.ts's content, unchanged since before F1b.1.
  const FROZEN_SHA256 = 'c4cbff947361f23524231a3fb8794b8e2c12f962fac1811213ba506f668cf955'

  it('lib/ai/runner.ts exists and its content hash matches the frozen pin', () => {
    expect(fs.existsSync(RUNNER_PATH)).toBe(true)
    const content = readNormalized(RUNNER_PATH)
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    expect(hash).toBe(FROZEN_SHA256)
  })

  it('has exactly the pre-existing prompt-kind predicates — no fourth one added alongside them', () => {
    const content = readNormalized(RUNNER_PATH)
    // isBrandVoice / isPostGeneration are the two ADR 0022 names by name;
    // isScoringOnly predates this ADR (Session 28, ADR 0021 §4.2) and is not
    // a carousel-work addition — the guarantee is no FOURTH predicate joined
    // these three during Session 29's format-family work.
    const predicateNames = Array.from(content.matchAll(/^function (is[A-Z]\w*)\(/gm)).map(m => m[1])
    expect(predicateNames.sort()).toEqual(['isBrandVoice', 'isPostGeneration', 'isScoringOnly'])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// MODE2-CAROUSEL-NO-IMAGE-GEN (ADR 0022 §6.4, L-8, constitution)
// ─────────────────────────────────────────────────────────────────────────
// "We don't generate images at launch" stands unamended: carousel ships as
// structured slide copy plus an imageBrief RECOMMENDATION, never a call that
// actually generates an image. Scanned the same way SCRIPT-NEVER-PUBLISHED
// scans for scriptBrief — a repo-wide absence check, not a downstream
// string check.

describe('MODE2-CAROUSEL-NO-IMAGE-GEN (ADR 0022 §6.4/L-8 — constitution: no image generation at launch)', () => {
  const IMAGE_GEN_PATTERN = /images\.generate\s*\(|generateImage\s*\(|\bdall-?e\b|\bstability-?ai\b|\breplicate\b|\btext-to-image\b/i
  const SCAN_ROOTS = [path.join(ROOT, 'lib'), path.join(ROOT, 'app')]

  it('no image-generation API call or SDK reference appears anywhere in lib/ or app/', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectTsFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const offenders: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of collectTsFiles(root)) {
        const source = stripLineComments(fs.readFileSync(file, 'utf8'))
        if (IMAGE_GEN_PATTERN.test(source)) offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// POSTS-DDL-UNMODIFIED (ADR 0022 §11.3)
// ─────────────────────────────────────────────────────────────────────────
// `posts` gains no column, constraint, index, policy or trigger anywhere in
// THIS ADR's work. The baseline is the last migration filed before Session
// 29's own two migrations — 20260814220000_insight_card_campaign_id.sql —
// NOT the last migration that legitimately touches `posts` DDL: several
// pre-Session-29 migrations (e.g. 20260726010000_learning_capture.sql's
// trg_posts_enqueue_edit_signal trigger, ADR 0018) legitimately add posts
// DDL and must NOT be scanned — only migrations filed AFTER Session 29
// began are this ADR's scope. SQL `--` line comments are stripped first so
// a column comment mentioning "posts" in passing (e.g. studio_drafts.sql's
// "unlike posts.platform's NOT NULL") never false-positives.

function stripSqlLineComments(source: string): string {
  return source
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
}

describe('POSTS-DDL-UNMODIFIED (ADR 0022 §11.3)', () => {
  const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')
  const BASELINE_FILENAME = '20260814220000_insight_card_campaign_id.sql'
  // Word-boundary on "posts" so post_ai_originals / post_metrics /
  // post_edit_signals never false-positive.
  const POSTS_DDL_PATTERN = /\b(ALTER|CREATE)\s+(TABLE|POLICY|TRIGGER|INDEX)\b[^;]*\bposts\b/i

  it('the baseline migration exists (guards against the reference going stale)', () => {
    expect(fs.existsSync(path.join(MIGRATIONS_DIR, BASELINE_FILENAME))).toBe(true)
  })

  it('no migration filed after Session 29 began references posts DDL', () => {
    const allMigrations = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
    const afterBaseline = allMigrations.filter(f => f > BASELINE_FILENAME)
    expect(afterBaseline.length, 'no migration was filed after the baseline — the scan has nothing to check').toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of afterBaseline) {
      const source = stripSqlLineComments(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
      if (POSTS_DDL_PATTERN.test(source)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// MODE3-UNTOUCHED (ADR 0022 §11.3, L-12) — RETIRED Session 30 G1b.3
// ─────────────────────────────────────────────────────────────────────────
// This tripwire's job was proving that ADR 0022's OWN carousel/promote work
// (Session 29, Track F) never touched Mode 3's lib/signals/ or the
// opportunities feed — a scope boundary between two CONCURRENT tracks in
// the same session, not a permanent freeze on lib/signals/ itself. It did
// its job: the frozen hash held for the whole of Track F.
//
// ADR 0023 (Session 30, Track G) is a properly adjudicated, later ADR whose
// entire purpose is to widen lib/signals/ (the market-responsive signal
// source) — G1b.3 through G1b.10 all touch files under this root by
// design. Re-freezing the hash at each step would just break it again at
// the next one, forever, for a track this constraint was never meant to
// gate. Retired rather than re-pinned; the original frozen pin
// (`be0913e9f9ee7885b761dbff015e6b6059d41d3b9c3b28e78b36513f712ebea8`,
// Session 29 F1b.11) remains recoverable from git history if a future
// session ever needs to confirm what Mode 3 looked like at Track F's close.

// ─────────────────────────────────────────────────────────────────────────
// NO-SKIP-REVIEW-PATH (ADR 0022 §11.3, ADR 0017 L-11/L-2)
// ─────────────────────────────────────────────────────────────────────────
// The skip-review fast path (ADR 0017 D-7/L-11) stays deferred; no
// configuration anywhere skips the mandatory brief-review gate (L-2).

describe('NO-SKIP-REVIEW-PATH (ADR 0022 §11.3, ADR 0017 L-11/L-2)', () => {
  const SKIP_REVIEW_PATTERN = /skipReview|bypassReview|autoApproveBrief|SKIP_REVIEW/i
  const SCAN_ROOTS = [path.join(ROOT, 'lib'), path.join(ROOT, 'app')]

  it('no skip-review / bypass-review identifier appears anywhere in lib/ or app/', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectTsFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const offenders: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of collectTsFiles(root)) {
        const source = stripLineComments(fs.readFileSync(file, 'utf8'))
        if (SKIP_REVIEW_PATTERN.test(source)) offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })

  it('CampaignStatus stays the frozen five-value union — no bypass status added', () => {
    const typesFile = path.join(ROOT, 'lib', 'db', 'types.ts')
    const source = fs.readFileSync(typesFile, 'utf8')
    const match = source.match(/export type CampaignStatus = ([^\n]+)/)
    expect(match, 'CampaignStatus type declaration not found — update this scan if it moved').not.toBeNull()
    const values = Array.from(match![1].matchAll(/'([a-z_]+)'/g)).map(m => m[1])
    expect(values.sort()).toEqual(['active', 'awaiting_brief', 'completed', 'draft', 'paused'])
  })
})
