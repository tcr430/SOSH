import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import {
  verifyStudioResponse,
  buildCitableContext,
  toStudioClientDTO,
  type ClaimedSuggestion,
  type StudioCall,
  type RenderedSuggestion,
  type VerifiedMemorySource,
} from './verify'
import type { GovernedPerformancePattern } from '@/lib/memory'

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }))

// ADR 0019 §7/§8 — the citation verifier's core contract: a rationale that
// CLAIMS a governed-memory source must be actually verified against the
// SENT context before it can render, and a failed claim demotes to
// model_judgment rather than being dropped or rendered unverified.

const GOVERNED_ROW: GovernedPerformancePattern = {
  rowId: '11111111-1111-4111-8111-111111111111',
  platform: 'linkedin',
  pattern: 'technical-comparison posts perform well for CTO audiences',
  confidence: 0.82,
  observationCount: 6,
}

const EVIDENCE_ROW = { id: '22222222-2222-4222-8222-222222222222', snippet: 'Customer X saved 10 hours per week' }

const DRAFT = 'We help you leverage your data. Please avoid empty buzzwords in general.'

function makeCitable() {
  return buildCitableContext({
    draft: DRAFT,
    avoidWords: new Set(['leverage', 'unused-word']),
    governedPatterns: [GOVERNED_ROW],
    evidence: [EVIDENCE_ROW],
  })
}

function claim(overrides: Partial<ClaimedSuggestion> = {}): ClaimedSuggestion {
  return {
    id: 's1',
    category: 'specificity',
    rationale: 'a rationale',
    ...overrides,
  }
}

describe('verifyStudioResponse — each source kind, verified', () => {
  it('avoid_word: verifies case-insensitively on both halves, renders the word AS SPELLED IN THE LIST (not the model claim string), with the real match offset', () => {
    const call: StudioCall = { citable: makeCitable(), parsed: [claim({ memorySource: { kind: 'avoid_word', word: 'LEVERAGE' } })] }
    const result = verifyStudioResponse(call)
    expect(result.outcome).toBe('clean')
    if (result.outcome !== 'clean') throw new Error('unreachable')
    const [rendered] = result.set
    expect(rendered.attribution).toBe('memory')
    if (rendered.attribution !== 'memory') throw new Error('unreachable')
    expect(rendered.source.kind).toBe('avoid_word')
    if (rendered.source.kind !== 'avoid_word') throw new Error('unreachable')
    expect(rendered.source.word).toBe('leverage') // as spelled in the list, not 'LEVERAGE'
    expect(rendered.source.matchOffset).toBe(DRAFT.toLowerCase().indexOf('leverage'))
  })

  it('performance_pattern: verifies by rowId, renders pattern/confidence/observationCount from the retrieved row', () => {
    const call: StudioCall = { citable: makeCitable(), parsed: [claim({ memorySource: { kind: 'performance_pattern', rowId: GOVERNED_ROW.rowId } })] }
    const result = verifyStudioResponse(call)
    expect(result.outcome).toBe('clean')
    if (result.outcome !== 'clean') throw new Error('unreachable')
    const source = result.set[0].attribution === 'memory' ? result.set[0].source : null
    expect(source).toEqual(
      expect.objectContaining({
        kind: 'performance_pattern',
        rowId: GOVERNED_ROW.rowId,
        pattern: GOVERNED_ROW.pattern,
        confidence: GOVERNED_ROW.confidence,
        observationCount: GOVERNED_ROW.observationCount,
      }),
    )
  })

  it('evidence: verifies by id, renders the snippet from the re-fetched row', () => {
    const call: StudioCall = { citable: makeCitable(), parsed: [claim({ memorySource: { kind: 'evidence', evidenceId: EVIDENCE_ROW.id } })] }
    const result = verifyStudioResponse(call)
    expect(result.outcome).toBe('clean')
    if (result.outcome !== 'clean') throw new Error('unreachable')
    const source = result.set[0].attribution === 'memory' ? result.set[0].source : null
    expect(source).toEqual(expect.objectContaining({ kind: 'evidence', evidenceId: EVIDENCE_ROW.id, snippet: EVIDENCE_ROW.snippet }))
  })
})

// Each test below pairs the one failing claim with a genuine second claim,
// so the failing claim's ratio (1 of 2) stays at or under the rejection
// threshold and its DEMOTION (not the separate reject-the-whole-response
// mechanics, covered in its own describe block below) is what's on display.
const GENUINE_CLAIM = claim({ id: 'genuine', memorySource: { kind: 'avoid_word', word: 'leverage' } })

describe('verifyStudioResponse — each failing kind demotes to model_judgment, never dropped, never rendered unverified', () => {
  it('a fabricated avoid-word (not on the list at all) demotes', () => {
    const call: StudioCall = {
      citable: makeCitable(),
      parsed: [claim({ memorySource: { kind: 'avoid_word', word: 'not-a-real-avoid-word' } }), GENUINE_CLAIM],
    }
    const result = verifyStudioResponse(call)
    expect(result.outcome).toBe('partial')
    if (result.outcome !== 'partial') throw new Error('unreachable')
    expect(result.set[0]).toEqual({ id: 's1', category: 'specificity', rationale: 'a rationale', attribution: 'model_judgment' })
    expect(result.fabricated).toHaveLength(1)
  })

  it('an avoid-word ON the list but ABSENT from the draft fails — BOTH conditions are required', () => {
    // 'unused-word' is in avoidWords but never appears in DRAFT.
    const call: StudioCall = {
      citable: makeCitable(),
      parsed: [claim({ memorySource: { kind: 'avoid_word', word: 'unused-word' } }), GENUINE_CLAIM],
    }
    const result = verifyStudioResponse(call)
    expect(result.outcome).toBe('partial')
    if (result.outcome !== 'partial') throw new Error('unreachable')
    expect(result.set[0].attribution).toBe('model_judgment')
  })

  it('a fabricated uuid (well-formed but not in the sent governed set) demotes', () => {
    const call: StudioCall = {
      citable: makeCitable(),
      parsed: [claim({ memorySource: { kind: 'performance_pattern', rowId: '99999999-9999-4999-8999-999999999999' } }), GENUINE_CLAIM],
    }
    const result = verifyStudioResponse(call)
    expect(result.outcome).toBe('partial')
    if (result.outcome !== 'partial') throw new Error('unreachable')
    expect(result.set[0].attribution).toBe('model_judgment')
    expect(result.fabricated[0]).toEqual({ id: 's1', source: { kind: 'performance_pattern', rowId: '99999999-9999-4999-8999-999999999999' } })
  })

  it('a fabricated evidence id demotes', () => {
    const call: StudioCall = {
      citable: makeCitable(),
      parsed: [claim({ memorySource: { kind: 'evidence', evidenceId: 'not-sent-id' } }), GENUINE_CLAIM],
    }
    const result = verifyStudioResponse(call)
    expect(result.outcome).toBe('partial')
    if (result.outcome !== 'partial') throw new Error('unreachable')
    expect(result.set[0].attribution).toBe('model_judgment')
  })
})

describe('verifyStudioResponse — verifies against the SENT set, never a fresh read', () => {
  it('the SAME claim verifies against one citable context and fails against another built from different data — proving the function is pure over its argument, with no external DB access', () => {
    const citableWithRow = makeCitable()
    const citableWithoutRow = buildCitableContext({ draft: DRAFT, avoidWords: new Set(['leverage']), governedPatterns: [], evidence: [] })

    const memorySource = { kind: 'performance_pattern' as const, rowId: GOVERNED_ROW.rowId }
    const withRow = verifyStudioResponse({ citable: citableWithRow, parsed: [claim({ memorySource })] })
    // Paired with a genuine second claim so a failure here demotes within a
    // 'partial' outcome rather than tripping the (separately tested)
    // reject-the-whole-response threshold.
    const withoutRow = verifyStudioResponse({
      citable: citableWithoutRow,
      parsed: [claim({ memorySource }), claim({ id: 'genuine', memorySource: { kind: 'avoid_word', word: 'leverage' } })],
    })

    expect(withRow.outcome).toBe('clean')
    expect(withoutRow.outcome).toBe('partial')
    // A pattern "promoted after the prompt was sent" would exist in a fresh
    // DB read but NOT in citableWithoutRow — and correctly fails here,
    // because verification never reads the DB, only the bound citable arg.
  })
})

describe('verifyStudioResponse — the rejected arm', () => {
  it('carries NO set when MORE THAN HALF of claiming suggestions fail verification', () => {
    const call: StudioCall = {
      citable: makeCitable(),
      parsed: [
        claim({ id: 's1', memorySource: { kind: 'avoid_word', word: 'fabricated-1' } }),
        claim({ id: 's2', memorySource: { kind: 'avoid_word', word: 'fabricated-2' } }),
        claim({ id: 's3', memorySource: { kind: 'avoid_word', word: 'leverage' } }), // genuine
      ],
    }
    const result = verifyStudioResponse(call)
    expect(result.outcome).toBe('rejected')
    expect('set' in result).toBe(false)
    if (result.outcome === 'rejected') {
      expect(result.fabricated).toHaveLength(2)
    }
  })

  it('exactly half (not MORE than half) does NOT reject — stays partial', () => {
    const call: StudioCall = {
      citable: makeCitable(),
      parsed: [
        claim({ id: 's1', memorySource: { kind: 'avoid_word', word: 'fabricated-1' } }),
        claim({ id: 's2', memorySource: { kind: 'avoid_word', word: 'leverage' } }),
      ],
    }
    const result = verifyStudioResponse(call)
    expect(result.outcome).toBe('partial')
  })

  it('a response with no memory claims at all is clean', () => {
    const call: StudioCall = { citable: makeCitable(), parsed: [claim({ id: 's1' }), claim({ id: 's2' })] }
    const result = verifyStudioResponse(call)
    expect(result.outcome).toBe('clean')
    if (result.outcome === 'clean') {
      expect(result.set.every((s) => s.attribution === 'model_judgment')).toBe(true)
    }
  })
})

describe('a derived_from_metrics pattern is STRUCTURALLY INADMISSIBLE', () => {
  it('a PerformancePattern-shaped (fallback) value cannot be passed as a GovernedPerformancePattern — compile-time only', () => {
    // A derived_from_metrics row has no rowId/confidence/observationCount
    // (PerformancePattern's shape, lib/memory/performance.ts) — it is not
    // just runtime-rejected, it cannot be SHAPED as GovernedPerformancePattern
    // at all, so this assignment fails to compile. TS attributes the excess
    // property error to that property's own line (not the opening brace),
    // so the suppression directive below sits directly above it.
    const fallbackRow: GovernedPerformancePattern = {
      platform: 'linkedin',
      // @ts-expect-error — topContent/likes/impressions/provenance don't exist on GovernedPerformancePattern, and rowId/pattern/confidence/observationCount are missing.
      topContent: 'one of your posts got a lot of likes',
      likes: 500,
      impressions: 10000,
      provenance: 'derived_from_metrics',
    }
    expect(fallbackRow).toBeDefined() // never reached meaningfully; the point is the line above doesn't compile without the ts-expect-error
  })
})

describe('@ts-expect-error — the memory arm cannot be constructed without a real VerifiedMemorySource', () => {
  it('a hand-written object cannot satisfy RenderedSuggestion\'s memory arm', () => {
    // The brand key isn't nameable outside verify.ts, so this hand-written
    // `source` object can never satisfy VerifiedMemorySource — TS attributes
    // the error to the `source:` property's own line.
    const forged: RenderedSuggestion = {
      id: 's1',
      category: 'specificity',
      rationale: 'forged',
      attribution: 'memory',
      // @ts-expect-error — missing the non-nameable brand key; cannot satisfy VerifiedMemorySource.
      source: { kind: 'avoid_word', word: 'leverage', matchOffset: 0 },
    }
    expect(forged).toBeDefined()
  })

  it('a bare object cannot satisfy VerifiedMemorySource directly either', () => {
    // @ts-expect-error — same reason: no module outside verify.ts can name the brand key to write it.
    const forged: VerifiedMemorySource = { kind: 'avoid_word', word: 'leverage', matchOffset: 0 }
    expect(forged).toBeDefined()
  })
})

describe('toStudioClientDTO', () => {
  it('produces a plain, unbranded DTO carrying the same verified fields', () => {
    const call: StudioCall = { citable: makeCitable(), parsed: [claim({ memorySource: { kind: 'evidence', evidenceId: EVIDENCE_ROW.id } })] }
    const result = verifyStudioResponse(call)
    if (result.outcome !== 'clean') throw new Error('unreachable')
    const dto = toStudioClientDTO(result.set[0])
    expect(dto).toEqual({
      id: 's1',
      category: 'specificity',
      rationale: 'a rationale',
      attribution: 'memory',
      source: { kind: 'evidence', evidenceId: EVIDENCE_ROW.id, snippet: EVIDENCE_ROW.snippet },
    })
  })

  it('a model_judgment suggestion has no source field on its DTO either', () => {
    const dto = toStudioClientDTO({ id: 's1', category: 'specificity', rationale: 'r', attribution: 'model_judgment' })
    expect(dto).not.toHaveProperty('source')
  })
})


// ── THREE SOURCE SCANS, each carrying a vacuity guard (the FALSE-GREEN
// shape ADR 0015 exists to catch — a scan that silently finds zero files
// would pass even if the property it claims to check no longer holds).

const SOURCE_ROOTS = ['lib', 'app', 'components'].map((d) => path.join(__dirname, '..', '..', d))

function collectSourceFiles(dir: string, excludeTestFiles: boolean): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath, excludeTestFiles))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      if (excludeTestFiles && /\.test\.(ts|tsx)$/.test(entry.name)) continue
      files.push(fullPath)
    }
  }
  return files
}

const VERIFY_TS_PATH = path.join(__dirname, 'verify.ts')
const VERIFY_TEST_TS_PATH = path.join(__dirname, 'verify.test.ts')

describe('source scan 1 — no cast onto the citation types outside verify.ts', () => {
  it('no file other than lib/studio/verify.ts contains `as VerifiedMemorySource`, `as RenderedSuggestion`, or `as unknown as` on the citation types', () => {
    const files = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(root, false)).filter(
      (f) => f !== VERIFY_TS_PATH && f !== VERIFY_TEST_TS_PATH, // verify.test.ts's @ts-expect-error blocks above deliberately attempt this
    )
    expect(files.length).toBeGreaterThan(0)

    const CAST_PATTERN = /as\s+VerifiedMemorySource|as\s+RenderedSuggestion|as\s+unknown\s+as\s+(VerifiedMemorySource|RenderedSuggestion)/

    const offenders: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      if (CAST_PATTERN.test(source)) offenders.push(path.relative(process.cwd(), file))
    }
    expect(offenders).toEqual([])
  })
})

describe('source scan 2 — no test file other than verify.test.ts mocks @/lib/studio/verify', () => {
  it('mocking the verifier elsewhere would let a boundary violation pass every OTHER test silently', () => {
    const files = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(root, false)).filter(
      (f) => /\.test\.(ts|tsx)$/.test(f) && f !== VERIFY_TEST_TS_PATH,
    )
    expect(files.length).toBeGreaterThan(0)

    const MOCK_PATTERN = /vi\.mock\(\s*['"]@\/lib\/studio\/verify['"]/

    const offenders: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      if (MOCK_PATTERN.test(source)) offenders.push(path.relative(process.cwd(), file))
    }
    expect(offenders).toEqual([])
  })
})

// D2.10 — components/studio/MemoryCitation.tsx:28 narrows StudioSuggestionDTO
// with `Extract<StudioSuggestionDTO, { attribution: 'memory' }>` — a TYPE
// utility selecting the DTO's already-verified memory arm, never a VALUE
// construction. The scan's regex is text-based and cannot tell type
// position from value position, so this file is excluded here rather than
// widening the regex into something less legible; MemoryCitation.tsx itself
// documents (§8.5) that toStudioClientDTO remains the single producer of
// the DTO's memory arm — this file only ever consumes it.
const MEMORY_CITATION_TSX_PATH = path.join(__dirname, '..', '..', 'components', 'studio', 'MemoryCitation.tsx')

describe('source scan 3 — the DTO\'s attribution:\'memory\' arm is constructed in exactly ONE file', () => {
  it('only verify.ts constructs an object literal with attribution: \'memory\'', () => {
    const files = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(root, true)).filter((f) => f !== MEMORY_CITATION_TSX_PATH)
    expect(files.length).toBeGreaterThan(0)

    const ATTRIBUTION_MEMORY_PATTERN = /attribution:\s*['"]memory['"]/

    const constructors: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      if (ATTRIBUTION_MEMORY_PATTERN.test(source)) constructors.push(path.relative(process.cwd(), file))
    }
    expect(constructors).toEqual([path.relative(process.cwd(), VERIFY_TS_PATH)])
  })
})
