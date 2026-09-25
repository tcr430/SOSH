import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/db/memory-evidence', () => ({
  importEvidenceMemory: vi.fn(),
}))
vi.mock('@/lib/db/memory-audience', () => ({
  importAudienceMemory: vi.fn(),
}))
vi.mock('@/lib/db/memory-performance', () => ({
  importPerformanceMemory: vi.fn(),
}))

import { importEvidenceMemory } from '@/lib/db/memory-evidence'
import { importAudienceMemory } from '@/lib/db/memory-audience'
import { importPerformanceMemory } from '@/lib/db/memory-performance'
import { importEvidenceItem, importAudienceItem, importPerformanceItem } from './import'

const mockImportEvidenceMemory = vi.mocked(importEvidenceMemory)
const mockImportAudienceMemory = vi.mocked(importAudienceMemory)
const mockImportPerformanceMemory = vi.mocked(importPerformanceMemory)

afterEach(() => {
  vi.clearAllMocks()
})

const evidenceRow = { id: 'ev-1' } as never
const audienceRow = { id: 'au-1' } as never
const performanceRow = { id: 'pf-1' } as never

describe('importEvidenceItem (ADR 0025 §9.4/§5.3, Session 32 I2.7)', () => {
  it('sets last_confirmed_at to the source publishedAt, not now', async () => {
    mockImportEvidenceMemory.mockResolvedValue([evidenceRow])

    await importEvidenceItem({
      businessId: 'biz-1',
      runId: 'run-1',
      sourcePostIds: ['post-1'],
      kind: 'quote',
      content: 'great tool',
      sourceUrl: null,
      platform: 'twitter',
      confidence: 0.5,
      publishedAt: '2024-01-15T00:00:00Z',
    })

    // formatISO() renders in the local offset (house rule: no direct
    // .toISOString()), so compare the same instant rather than the exact
    // string — the point under test is "the SOURCE date, not now()".
    const call = mockImportEvidenceMemory.mock.calls[0][0]
    expect(new Date(call.last_confirmed_at).getTime()).toBe(new Date('2024-01-15T00:00:00Z').getTime())
  })

  it('a non-finite publishedAt throws BEFORE the write, zero RPC calls', async () => {
    await expect(
      importEvidenceItem({
        businessId: 'biz-1',
        runId: 'run-1',
        sourcePostIds: ['post-1'],
        kind: 'quote',
        content: 'great tool',
        sourceUrl: null,
        platform: 'twitter',
        confidence: 0.5,
        publishedAt: 'not-a-date',
      }),
    ).rejects.toThrow(/not a finite date/)
    expect(mockImportEvidenceMemory).not.toHaveBeenCalled()
  })

  it('usage_data expires_at = publishedAt + 12 months; an already-expired usage_data row is not written', async () => {
    const result = await importEvidenceItem({
      businessId: 'biz-1',
      runId: 'run-1',
      sourcePostIds: ['post-1'],
      kind: 'usage_data',
      content: 'we hit 10k signups',
      sourceUrl: null,
      platform: 'twitter',
      confidence: 0.5,
      publishedAt: '2000-01-01T00:00:00Z', // 12 months later is long expired
    })
    expect(result).toBeNull()
    expect(mockImportEvidenceMemory).not.toHaveBeenCalled()
  })

  it('a quote/case_study row gets expires_at NULL (not time-bound)', async () => {
    mockImportEvidenceMemory.mockResolvedValue([evidenceRow])
    await importEvidenceItem({
      businessId: 'biz-1',
      runId: 'run-1',
      sourcePostIds: ['post-1'],
      kind: 'case_study',
      content: 'a customer story',
      sourceUrl: null,
      platform: 'twitter',
      confidence: 0.5,
      publishedAt: '2000-01-01T00:00:00Z',
    })
    expect(mockImportEvidenceMemory).toHaveBeenCalledWith(expect.objectContaining({ expires_at: null }))
  })
})

describe('importAudienceItem', () => {
  it('sets last_confirmed_at to the source publishedAt and expires_at NULL (not time-bound)', async () => {
    mockImportAudienceMemory.mockResolvedValue([audienceRow])

    await importAudienceItem({
      businessId: 'biz-1',
      runId: 'run-1',
      sourcePostIds: ['post-1', 'post-2'],
      segment: null,
      kind: 'problem',
      statement: 'CTOs struggle with cadence',
      platform: 'twitter',
      confidence: 0.3,
      publishedAt: '2025-03-01T00:00:00Z',
    })

    const call = mockImportAudienceMemory.mock.calls[0][0]
    expect(new Date(call.last_confirmed_at).getTime()).toBe(new Date('2025-03-01T00:00:00Z').getTime())
    expect(call.expires_at).toBeNull()
  })

  it('a non-finite publishedAt throws BEFORE the write, zero RPC calls', async () => {
    await expect(
      importAudienceItem({
        businessId: 'biz-1',
        runId: 'run-1',
        sourcePostIds: ['post-1'],
        segment: null,
        kind: 'problem',
        statement: 'x',
        platform: 'twitter',
        confidence: 0.3,
        publishedAt: 'NaN',
      }),
    ).rejects.toThrow(/not a finite date/)
    expect(mockImportAudienceMemory).not.toHaveBeenCalled()
  })
})

describe('importPerformanceItem', () => {
  it('uses the NEWEST of the backing posts for last_confirmed_at', async () => {
    mockImportPerformanceMemory.mockResolvedValue([performanceRow])

    await importPerformanceItem({
      businessId: 'biz-1',
      runId: 'run-1',
      sourcePostIds: ['post-1', 'post-2'],
      dimension: 'format',
      pattern: 'video posts do well',
      platform: 'linkedin',
      confidence: 0.48,
      observationCount: 8,
      newestPublishedAt: '2026-06-01T00:00:00Z',
    })

    const call = mockImportPerformanceMemory.mock.calls[0][0]
    expect(new Date(call.last_confirmed_at).getTime()).toBe(new Date('2026-06-01T00:00:00Z').getTime())
  })

  it('expires_at = newest backing post + 12 months; an already-expired pattern is not written', async () => {
    const result = await importPerformanceItem({
      businessId: 'biz-1',
      runId: 'run-1',
      sourcePostIds: ['post-1'],
      dimension: 'format',
      pattern: 'old pattern',
      platform: 'linkedin',
      confidence: 0.3,
      observationCount: 5,
      newestPublishedAt: '2000-01-01T00:00:00Z',
    })
    expect(result).toBeNull()
    expect(mockImportPerformanceMemory).not.toHaveBeenCalled()
  })

  it('a non-finite newestPublishedAt throws BEFORE the write, zero RPC calls', async () => {
    await expect(
      importPerformanceItem({
        businessId: 'biz-1',
        runId: 'run-1',
        sourcePostIds: ['post-1'],
        dimension: 'format',
        pattern: 'x',
        platform: 'linkedin',
        confidence: 0.3,
        observationCount: 5,
        newestPublishedAt: 'not-a-date',
      }),
    ).rejects.toThrow(/not a finite date/)
    expect(mockImportPerformanceMemory).not.toHaveBeenCalled()
  })
})

// ADR 0025 §9.4 MEM-NO-DIRECT-TABLE-ACCESS (import-path counterpart to
// lib/learning/memory-table-boundary.test.ts) — importEvidenceMemory/
// importAudienceMemory/importPerformanceMemory (lib/db/memory-{evidence,
// audience,performance}.ts) must have exactly ONE caller: this module. A
// direct call from lib/backfill/**, an app route, or anywhere else would
// bypass the source-dating and expiry rules this file exists to enforce.
describe('MEM-NO-DIRECT-TABLE-ACCESS (import path, Tier-2 source scan)', () => {
  const ROOT = path.join(__dirname, '..', '..')
  const SCAN_DIRS = ['lib', 'app']
  // ADR 0029 §2.3 INTERVIEW-WRITER-SOLE-CALLER: the interview writer joins the alternation. Its
  // exported name is FIXED as writeInterviewCandidates (lib/db/memory-interview.ts, M2.5) and its
  // sole caller is lib/memory/interview.ts.
  const FORBIDDEN = /\bimport(?:Evidence|Audience|Performance)Memory\b|\bwriteInterviewCandidates\b/

  function collectTsFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...collectTsFiles(fullPath))
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
        files.push(fullPath)
      }
    }
    return files
  }

  it('no file outside lib/memory/ imports importEvidenceMemory, importAudienceMemory, or importPerformanceMemory', () => {
    const memoryDir = path.join(ROOT, 'lib', 'memory')
    const offenders: string[] = []

    for (const scanDir of SCAN_DIRS) {
      const files = collectTsFiles(path.join(ROOT, scanDir))
      expect(files.length, `${scanDir} contributed zero files to the scan`).toBeGreaterThan(0)
      for (const file of files) {
        if (file.startsWith(memoryDir)) continue // lib/memory/ itself is the allowed caller
        // The three lib/db/memory-*.ts DEFINITION files legitimately contain
        // the function names in their own `export async function` lines —
        // only a file that IMPORTS the symbol (a caller) is an offender.
        const source = fs.readFileSync(file, 'utf8')
        const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line) && line.includes('memory-'))
        for (const line of importLines) {
          if (FORBIDDEN.test(line)) offenders.push(`${path.relative(ROOT, file)}: ${line.trim()}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  // ADR 0029 §2.3 / §10.3 INTERVIEW-WRITER-SOLE-CALLER (Tier 3). The line filter above only sees
  // static `import` lines that mention `memory-`; a dynamic `await import('.../memory-interview')`,
  // a multi-line destructure, or a direct `.rpc('write_interview_candidates')` slips past it. This
  // detector reads the comment-stripped WHOLE source and flags all four shapes. The allowed files
  // are lib/memory/ (the sole caller) and lib/db/memory-interview.ts (the definition).
  // Known blind spot (ADR §10.3): none known.
  function stripComments(source: string): string {
    return source
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
      .join('\n')
  }

  function findInterviewWriterCallers(source: string): string[] {
    const code = stripComments(source)
    const hits: string[] = []
    for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]*memory-interview)['"]/g)) hits.push(m[1])
    for (const m of code.matchAll(/\bwriteInterviewCandidates\b/g)) hits.push(m[0])
    for (const m of code.matchAll(/['"`]write_interview_candidates['"`]/g)) hits.push(m[0])
    return hits
  }

  it('the interview-writer detector flags static, dynamic, multi-line and rpc shapes (planted violations)', () => {
    expect(findInterviewWriterCallers("import { writeInterviewCandidates } from '@/lib/db/memory-interview'")).toEqual([
      '@/lib/db/memory-interview',
      'writeInterviewCandidates',
    ])
    expect(findInterviewWriterCallers("const { writeInterviewCandidates } = await import('@/lib/db/memory-interview')")).toEqual([
      '@/lib/db/memory-interview',
      'writeInterviewCandidates',
    ])
    expect(findInterviewWriterCallers("const m = await import(\n  '../db/memory-interview'\n)")).toEqual(['../db/memory-interview'])
    expect(findInterviewWriterCallers("import {\n  writeInterviewCandidates,\n} from './x'")).toEqual(['writeInterviewCandidates'])
    expect(findInterviewWriterCallers("await client.rpc('write_interview_candidates', args)")).toEqual(["'write_interview_candidates'"])
  })

  it('the interview-writer detector does NOT flag unrelated imports, comments or lookalike names (planted negative)', () => {
    expect(findInterviewWriterCallers("import { importEvidenceMemory } from '@/lib/db/memory-evidence'")).toEqual([])
    expect(findInterviewWriterCallers("// import { writeInterviewCandidates } from '@/lib/db/memory-interview'")).toEqual([])
    expect(findInterviewWriterCallers("/* client.rpc('write_interview_candidates') */ const x = 1")).toEqual([])
    expect(findInterviewWriterCallers("import { INTERVIEW_SLOTS } from '@/lib/interview/constants'")).toEqual([])
    expect(findInterviewWriterCallers('const writeInterviewCandidatesLike = 1')).toEqual([])
  })

  it('no file outside lib/memory/ and lib/db/memory-interview.ts references the interview writer', () => {
    const memoryDir = path.join(ROOT, 'lib', 'memory')
    const definition = path.join(ROOT, 'lib', 'db', 'memory-interview.ts')
    const offenders: string[] = []
    let scanned = 0

    for (const scanDir of SCAN_DIRS) {
      const files = collectTsFiles(path.join(ROOT, scanDir))
      expect(files.length, `${scanDir} contributed zero files to the scan`).toBeGreaterThan(0)
      for (const file of files) {
        if (file.startsWith(memoryDir) || file === definition) continue
        scanned += 1
        const hits = findInterviewWriterCallers(fs.readFileSync(file, 'utf8'))
        if (hits.length > 0) offenders.push(`${path.relative(ROOT, file)}: ${hits.join(', ')}`)
      }
    }

    expect(scanned, 'the scan matched too few files — it would pass vacuously').toBeGreaterThanOrEqual(300)
    expect(offenders).toEqual([])
  })
})
