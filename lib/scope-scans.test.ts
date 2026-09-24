import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

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
// MODE2-RUNNER-UNTOUCHED (ADR 0022 §6.5, §11.3 "RUNNER-UNMODIFIED") — RETIRED
// H2.1 (Session 31, Track H)
// ─────────────────────────────────────────────────────────────────────────
// This tripwire's job was proving that ADR 0022's OWN carousel/promote work
// (Session 29, Track F) never touched lib/ai/runner.ts — a scope boundary
// for THAT session's track, not a permanent freeze on the runner forever.
// Exactly the same shape as MODE3-UNTOUCHED and POSTS-DDL-UNMODIFIED below,
// retired the same way and for the same reason.
//
// ADR 0024 (Session 31, Track H) is a properly adjudicated, later ADR whose
// entire purpose is generation-quality changes inside lib/ai/ — §3.1 adds
// optional temperature/thinking fields read at runner.ts's SDK-params
// assembly, §6.4 teaches the parse path tool_use, and §7 places the new
// budget reservation outside and above runPrompt without reordering its
// existing guards. H2.1 through H2.10 all touch this file by design.
// Re-pinning the hash at each step would just break it again at the next
// one, forever, for a track this constraint was never meant to gate.
// Retired rather than re-pinned or silently patched, on the
// POSTS-DDL-UNMODIFIED / MODE3-UNTOUCHED precedent immediately below.
//
// The former hash pin ('c4cbff947361f23524231a3fb8794b8e2c12f962fac1811213ba506f668cf955',
// Session 29 F1b.11) and the "no fourth is[A-Z]\w* predicate" assertion
// remain recoverable from git history if a future session ever needs to
// confirm what the runner looked like at Track F's close.

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
// POSTS-DDL-UNMODIFIED (ADR 0022 §11.3) — RETIRED N2.13 (Session 30.5)
// ─────────────────────────────────────────────────────────────────────────
// This tripwire's job was proving that ADR 0022's OWN work (Session 29,
// Track F) never touched `posts` DDL — a scope boundary for THAT session's
// track, not a permanent freeze on the `posts` table forever. Exactly the
// same shape as MODE3-UNTOUCHED immediately below, retired the same way and
// for the same reason.
//
// ADR 0028 (Session 30.5, Track N) is a properly adjudicated, later ADR
// whose §5.3 explicitly adds `posts.social_account_id` (migration
// 20260904100000_posts_social_account_id.sql) — reviewed, Tier-1 tested,
// and cascade-table-reasoned in that ADR, not scope creep this constraint
// was meant to catch. Discovered when N2.13's own push turned this suite
// red for the first time since that migration landed (this repo's local
// vitest scoping convention omits lib/scope-scans.test.ts — a direct file
// in lib/, matched by no per-directory filter — so this only surfaces once
// CI runs the real `npm run test:app`). Re-pinning the baseline forward
// would just break it again at the next legitimately-adjudicated `posts`
// change, forever, for a constraint this specific never meant to gate.
// Retired rather than re-pinned or silently patched.
//
// The former test asserted: no migration filed after
// `20260814220000_insight_card_campaign_id.sql` references `posts` DDL
// (word-boundary ALTER/CREATE TABLE/POLICY/TRIGGER/INDEX referencing
// `posts`, SQL line comments stripped first). If a future session needs to
// confirm what that boundary looked like, `git log -p -- lib/scope-scans.test.ts`
// at this commit recovers the exact pattern and baseline filename.

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

// ─────────────────────────────────────────────────────────────────────────
// ADR 0024 (Session 31, Track H, H2.13), corrected by §15 (Session 31-D,
// D1/MAJOR-2) — three Tier-3 scans, each demonstrated to redden against a
// temporary violation and then reverted:
// - QUAL-NO-NEW-AI-SURFACE: temporarily added an ELEVENTH PROMPT FILE under
//   lib/ai/prompts/ — a real module structurally satisfying Prompt, with NO
//   import-list edit anywhere — re-ran, observed BOTH this bijection
//   assertion AND prompt-properties.frozen-table.test.ts's own assertion go
//   RED, reverted. The prior demonstration (editing a hand-written import
//   list) proved only that the list could be edited, not that an unlisted
//   prompt would be caught — see docs/reviews/session-31-reviewer.md's
//   CORRECTION PASS (Session 31-D) appendix, MAJOR-2.
// - QUAL-PARSER-RETAINED: temporarily commented out the
//   `extractJsonBlock` export in lib/ai/parsers.ts, re-ran, observed the
//   "still exported" assertion fail (a TS compile error at import time,
//   which vitest surfaces as a failed test file), reverted.
// - QUAL-MODE2-FIXTURES-MIGRATED: temporarily deleted
//   lib/ai/__fixtures__/post-generation/linkedin.json, re-ran, observed the
//   file-existence assertion fail, reverted (git restore).
// ─────────────────────────────────────────────────────────────────────────

describe('QUAL-NO-NEW-AI-SURFACE (ADR 0024 §L-8, H2.13)', () => {
  // D1/MAJOR-2: consumes the SAME filesystem-walking collector as
  // prompt-properties.frozen-table.test.ts (lib/ai/prompts/collect-prompts.ts)
  // rather than a second, independently hand-maintained import list — a
  // duplicated enumeration is exactly how MAJOR-2 happened: an eleventh
  // prompt could be added to disk without touching either list, and both
  // scans stayed green. The assertion is now a BIJECTION against the same
  // frozen table prompt-properties.frozen-table.test.ts checks
  // (lib/ai/prompts/frozen-table.ts) — every enumerated id has a row, and
  // every row has an enumerated id — which is what "no new AI surface"
  // actually means; a bare `size === 10` passes even when the ten ids
  // enumerated are not the ten the frozen table expects.
  it('every enumerated prompt id has a frozen-table row, and every frozen-table row has an enumerated id — no eleventh (new prompt family)', async () => {
    const { collectPrompts } = await import('./ai/prompts/collect-prompts')
    const { FROZEN_TABLE } = await import('./ai/prompts/frozen-table')

    const prompts = await collectPrompts()
    const enumeratedIds = new Set(prompts.map((p) => p.id))
    const frozenIds = new Set(Object.keys(FROZEN_TABLE))

    expect(enumeratedIds.size, 'a duplicate id among enumerated prompts').toBe(prompts.length)
    for (const id of enumeratedIds) {
      expect(frozenIds.has(id), `enumerated prompt id "${id}" has no frozen-table row — a new prompt/family shipped unversioned`).toBe(true)
    }
    for (const id of frozenIds) {
      expect(enumeratedIds.has(id), `frozen-table row "${id}" has no enumerated prompt — a stale row, or the walk is missing a file`).toBe(true)
    }
  })

  it('no new user-facing generation entry point: generate-action.ts stays the sole Server Action calling generatePostsForCampaign', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib', 'campaigns', 'generate.ts'), 'utf8')
    expect(source).toContain('export async function generatePostsForCampaign')

    const callers: string[] = []
    for (const root of [path.join(ROOT, 'app')]) {
      for (const file of collectTsFiles(root)) {
        const content = stripLineComments(fs.readFileSync(file, 'utf8'))
        if (/\bgeneratePostsForCampaign\s*\(/.test(content) && !file.endsWith('.test.ts')) {
          callers.push(path.relative(ROOT, file).replace(/\\/g, '/'))
        }
      }
    }
    expect(callers).toEqual(['app/[locale]/(dashboard)/campaigns/[id]/generate-action.ts'])
  })
})

describe('QUAL-PARSER-RETAINED (ADR 0024 §6.5, H2.13)', () => {
  it('extractJsonBlock is still exported and still exercised by safeParseOrAiError, the text-path parser nine prompts and tool-runner.ts:445 both depend on', async () => {
    const parsersModule = await import('./ai/parsers')
    expect(typeof parsersModule.extractJsonBlock).toBe('function')
    expect(typeof parsersModule.safeParseOrAiError).toBe('function')

    const runnerSource = fs.readFileSync(path.join(ROOT, 'lib', 'ai', 'runner.ts'), 'utf8')
    expect(runnerSource).toContain('safeParseOrAiError(prompt.outputSchema, rawText)')

    const toolRunnerSource = fs.readFileSync(path.join(ROOT, 'lib', 'ai', 'tool-runner.ts'), 'utf8')
    // Session 34 K2.2 (ADR 0027 §3.1): the decision schema became a PARAMETER of runToolLoop (defaulting to
    // TriageDecisionSchema), so the still-exercised call now names the parameter. The assertion's purpose —
    // that the text-path parser is still what tool-runner.ts parses a decision with — is unchanged.
    expect(toolRunnerSource).toContain('safeParseOrAiError(outputSchema, rawText)')
  })
})

describe('QUAL-MODE2-FIXTURES-MIGRATED (ADR 0024 §4.1, H2.13)', () => {
  // The audit's answer, recorded: ZERO fixtures moved for sampling reasons
  // (the L-5 premise that sampling moves fixtures is false for this repo —
  // temperature/thinking are SDK params, not response-shape changes). All
  // five post-generation fixtures are KEPT — lib/ai/client.ts routes
  // promptId === 'post-generation' to this directory, and deleting them
  // converts any future call into a hard "fixture not found" throw. Their
  // eventual deletion is tracked separately as backlog item
  // 31-DEAD-POST-GENERATION-PROMPT, one diff with the prompt's own removal.
  it('all five post-generation mock fixtures still exist, unmigrated, unrecorded-for-sampling', () => {
    const dir = path.join(ROOT, 'lib', 'ai', '__fixtures__', 'post-generation')
    const expected = ['facebook.json', 'instagram.json', 'linkedin.json', 'threads.json', 'twitter.json']
    for (const name of expected) {
      expect(fs.existsSync(path.join(dir, name)), `missing fixture: ${name}`).toBe(true)
    }
  })
})

describe('L-1: Session 31 adds NO lib/memory/ write path (ADR 0024 §12.1, H2.13)', () => {
  it('no lib/memory/*.ts file (excluding tests) calls .insert(/.update(/.upsert(/.rpc( — read-only, as designed', () => {
    const dir = path.join(ROOT, 'lib', 'memory')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(files.length).toBeGreaterThan(0)

    const WRITE_PATTERN = /\.(insert|update|upsert)\s*\(|\.rpc\s*\(/
    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (WRITE_PATTERN.test(source)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})

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
