import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }))
vi.mock('@/lib/db/memory-evidence', () => ({ getEvidenceMemoryByIds: vi.fn() }))

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEvidenceMemoryByIds } from '@/lib/db/memory-evidence'
import { bindEvidenceForPrompt, type BoundEvidence } from '@/lib/ai/wrap-evidence'
import { verifyClaims, toPersistedClaimCheck } from './verify-claims'

// ADR 0027 §4.2-§4.8 (Session 34 K2.9). Constraints: 19 AGENCY-CLAIM-EVIDENCE-TRACEABLE, 20
// AGENCY-CLAIM-NO-CORPUS-DISTINCT, 23 AGENCY-VERIFY-CROSS-REFERENCED (Tier 3), and the Tier-3 half of 18
// AGENCY-CLAIMS-FLAGGED-NEVER-EDITED. The Tier-2 half of 18 (the wiring never edits or withholds) is in
// generate.test.ts.
//
// SHARED-FUNCTION CALLERS: verifyClaims / toPersistedClaimCheck have ONE production caller, generate.ts (wiring
// tests in generate.test.ts, block 'claim verification'). bindEvidenceForPrompt's callers: generate.ts (bound once)
// and generate-native.ts (own binding for regeneration) — covered by generate.test.ts and generate-native.test.ts;
// its own behaviour is below.

const client = {} as SupabaseClient
const CONTENT = 'We cut churn by 42% in Q3. Acme, the fastest tool, agrees.'
const C1 = 'We cut churn by 42% in Q3.'
const C2 = 'the fastest tool'

// A REAL BoundEvidence, minted through the one legitimate path (no cast), from a mocked store read.
async function bind(ids: string[]): Promise<BoundEvidence> {
  vi.mocked(getEvidenceMemoryByIds).mockResolvedValue(ids.map((id) => ({ id, content: `content of ${id}` })) as never)
  return bindEvidenceForPrompt(client, 'biz-1', ids)
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('verifyClaims — exact id intersection against the set SENT in this call (constraint 19)', () => {
  it('SUPPORTED: the cited id is in the sent set', async () => {
    const bound = await bind(['ev-1', 'ev-2'])
    const r = verifyClaims({ claims: [{ text: C1, evidenceMemoryId: 'ev-2' }], content: CONTENT, bound, hasEvidenceCorpus: true })
    expect(r.status).toBe('checked')
    if (r.status !== 'checked') return
    expect(r.claims[0].outcome).toBe('supported')
    expect(r.claims[0].outcome === 'supported' && r.claims[0].evidence.evidenceMemoryId).toBe('ev-2')
  })

  it('UNSUPPORTED: the claim carries no evidenceMemoryId (absent, null and empty string alike)', async () => {
    const bound = await bind(['ev-1'])
    const r = verifyClaims({
      claims: [{ text: C1 }, { text: C2, evidenceMemoryId: null }, { text: 'x', evidenceMemoryId: '' }],
      content: CONTENT,
      bound,
      hasEvidenceCorpus: true,
    })
    expect(r.status === 'checked' && r.claims.map((c) => c.outcome)).toEqual(['unsupported', 'unsupported', 'unsupported'])
  })

  it('FABRICATED: the cited id is not in the sent set', async () => {
    const bound = await bind(['ev-1'])
    const r = verifyClaims({ claims: [{ text: C1, evidenceMemoryId: 'ev-nope' }], content: CONTENT, bound, hasEvidenceCorpus: true })
    expect(r.status === 'checked' && r.claims[0].outcome).toBe('fabricated')
  })

  it('a CROSS-TENANT id is FABRICATED: the store read is business-scoped, so a foreign id is simply not a member', async () => {
    // The DB read is tenant-scoped (getEvidenceMemoryByIds filters business_id), so the foreign row is never
    // returned and its id never enters the sent set — even though it EXISTS in the table.
    const bound = await bind(['ev-mine'])
    expect(getEvidenceMemoryByIds).toHaveBeenCalledWith(client, 'biz-1', ['ev-mine'])
    const r = verifyClaims({ claims: [{ text: C1, evidenceMemoryId: 'ev-of-another-business' }], content: CONTENT, bound, hasEvidenceCorpus: true })
    expect(r.status === 'checked' && r.claims[0].outcome).toBe('fabricated')
  })

  it('a retired/demoted row (dropped by the status=active read) is not in the sent set, so citing it is fabricated', async () => {
    // pinned [ev-1, ev-retired]; the read returns only the active one.
    vi.mocked(getEvidenceMemoryByIds).mockResolvedValue([{ id: 'ev-1', content: 'c' }] as never)
    const bound = await bindEvidenceForPrompt(client, 'biz-1', ['ev-1', 'ev-retired'])
    const r = verifyClaims({ claims: [{ text: C1, evidenceMemoryId: 'ev-retired' }], content: CONTENT, bound, hasEvidenceCorpus: true })
    expect(r.status === 'checked' && r.claims[0].outcome).toBe('fabricated')
  })

  it('the verdict is per claim: a mixed set yields a mixed result, in order', async () => {
    const bound = await bind(['ev-1'])
    const r = verifyClaims({
      claims: [{ text: C1, evidenceMemoryId: 'ev-1' }, { text: C2 }, { text: 'z', evidenceMemoryId: 'ev-x' }],
      content: CONTENT,
      bound,
      hasEvidenceCorpus: true,
    })
    expect(r.status === 'checked' && r.claims.map((c) => c.outcome)).toEqual(['supported', 'unsupported', 'fabricated'])
  })
})

describe('the empty-corpus state (constraint 20)', () => {
  it('nothing sent AND no active evidence -> no_corpus, NEVER "N unsupported claims"', async () => {
    const bound = await bind([])
    const r = verifyClaims({ claims: [{ text: C1 }, { text: C2 }, { text: 'a third' }], content: CONTENT, bound, hasEvidenceCorpus: false })
    expect(r).toEqual({ status: 'no_corpus' })
    expect(r.status).not.toBe('checked')
  })

  it('DISTINGUISHABLE: the same uncited claims WITH a corpus are flagged unsupported', async () => {
    const bound = await bind([])
    const withCorpus = verifyClaims({ claims: [{ text: C1 }], content: CONTENT, bound, hasEvidenceCorpus: true })
    const without = verifyClaims({ claims: [{ text: C1 }], content: CONTENT, bound, hasEvidenceCorpus: false })
    expect(withCorpus.status).toBe('checked')
    expect(without.status).toBe('no_corpus')
  })

  it('no claims at all is no_claims, even with no corpus (there is nothing to say)', async () => {
    const bound = await bind([])
    expect(verifyClaims({ claims: [], content: CONTENT, bound, hasEvidenceCorpus: false })).toEqual({ status: 'no_claims' })
    expect(verifyClaims({ claims: undefined, content: CONTENT, bound, hasEvidenceCorpus: true })).toEqual({ status: 'no_claims' })
    expect(verifyClaims({ claims: null, content: CONTENT, bound, hasEvidenceCorpus: true })).toEqual({ status: 'no_claims' })
  })

  it('evidence was sent -> never no_corpus, whatever hasEvidenceCorpus says', async () => {
    const bound = await bind(['ev-1'])
    expect(verifyClaims({ claims: [{ text: C1 }], content: CONTENT, bound, hasEvidenceCorpus: false }).status).toBe('checked')
  })
})

describe('spans: every rendered byte comes from the post, never from the model claim string', () => {
  it('locates the claim verbatim in the post text as offsets', async () => {
    const bound = await bind(['ev-1'])
    const r = verifyClaims({ claims: [{ text: C2 }], content: CONTENT, bound, hasEvidenceCorpus: true })
    const span = r.status === 'checked' ? r.claims[0].span : null
    expect(span).not.toBeNull()
    expect(CONTENT.slice(span!.start, span!.end)).toBe(C2)
  })

  it('a claim text NOT found verbatim keeps its flag with span null (still flagged, just not highlightable)', async () => {
    const bound = await bind(['ev-1'])
    const r = verifyClaims({ claims: [{ text: 'a paraphrase the model invented' }], content: CONTENT, bound, hasEvidenceCorpus: true })
    expect(r.status === 'checked' && r.claims[0].span).toBeNull()
    expect(r.status === 'checked' && r.claims[0].outcome).toBe('unsupported')
  })

  it('the persisted form carries no claim text, and a fabricated/unsupported claim carries no id at all', async () => {
    const bound = await bind(['ev-1'])
    const v = verifyClaims({
      claims: [{ text: C1, evidenceMemoryId: 'ev-1' }, { text: C2, evidenceMemoryId: 'ev-FOREIGN' }, { text: 'no id' }],
      content: CONTENT,
      bound,
      hasEvidenceCorpus: true,
    })
    const persisted = toPersistedClaimCheck(v)
    const json = JSON.stringify(persisted)
    expect(json).not.toContain('ev-FOREIGN')
    expect(json).not.toContain('churn')
    expect(persisted.status === 'checked' && persisted.claims.map((c) => c.evidenceMemoryId)).toEqual(['ev-1', undefined, undefined])
  })

  it('non-checked results persist as their bare status', () => {
    expect(toPersistedClaimCheck({ status: 'no_corpus' })).toEqual({ status: 'no_corpus' })
    expect(toPersistedClaimCheck({ status: 'no_claims' })).toEqual({ status: 'no_claims' })
  })
})

describe('a high fabrication rate emits a Sentry COUNT only — never withholds (L-4), never console.*', () => {
  let consoleSpies: Array<ReturnType<typeof vi.spyOn>>
  beforeEach(() => {
    consoleSpies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined))
  })
  afterEach(() => consoleSpies.forEach((s) => s.mockRestore()))

  it('above half of the CITING claims fabricated: one redacted Sentry message, and every claim still rendered', async () => {
    const bound = await bind(['ev-1'])
    const r = verifyClaims({
      claims: [{ text: C1, evidenceMemoryId: 'ev-x' }, { text: C2, evidenceMemoryId: 'ev-y' }, { text: 'k', evidenceMemoryId: 'ev-1' }],
      content: CONTENT,
      bound,
      hasEvidenceCorpus: true,
    })
    expect(r.status === 'checked' && r.claims).toHaveLength(3) // nothing dropped
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
    const [message, hint] = vi.mocked(Sentry.captureMessage).mock.calls[0]
    expect(message).toBe('campaign_fabricated_citation_rate')
    expect(hint).toEqual({ level: 'warning', tags: { fabricated_citation_count: 2, citing_claim_count: 3 } })
    const serialised = JSON.stringify(vi.mocked(Sentry.captureMessage).mock.calls)
    for (const secret of [C1, C2, 'ev-x', 'ev-y', 'churn']) expect(serialised).not.toContain(secret)
    for (const s of consoleSpies) expect(s).not.toHaveBeenCalled()
  })

  it('at or below half: no message', async () => {
    const bound = await bind(['ev-1'])
    verifyClaims({ claims: [{ text: C1, evidenceMemoryId: 'ev-x' }, { text: C2, evidenceMemoryId: 'ev-1' }], content: CONTENT, bound, hasEvidenceCorpus: true })
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('uncited claims do not count toward the fabrication rate (only claims that CITE can be fabricated)', async () => {
    const bound = await bind(['ev-1'])
    verifyClaims({ claims: [{ text: C1 }, { text: C2 }, { text: 'k', evidenceMemoryId: 'ev-x' }], content: CONTENT, bound, hasEvidenceCorpus: true })
    // 1 of 1 citing claims fabricated -> above half -> fires; the two uncited ones did not dilute it
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
  })
})

describe('AGENCY-VERIFY-CROSS-REFERENCED (constraint 23, Tier 3) — the three instantiations name each other', () => {
  const PATHS = ['lib/studio/verify.ts', 'lib/signals/triage/verify.ts', 'lib/campaigns/verify-claims.ts'] as const
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
  const commentLines = (s: string) => [...s.matchAll(/\/\/[^\n]*/g)].map((m) => m[0])
  // ONLY the CROSS-REFERENCE block itself (the marker line and the map that follows it, up to its closing blank
  // comment line) — a sibling's path mentioned ELSEWHERE in the file's comments must not satisfy the scan, or
  // renaming a module inside the map would go unnoticed (the file already cites lib/studio/verify.ts in prose).
  const commentsOnly = (s: string) => {
    const lines = commentLines(s)
    const start = lines.findIndex((l) => l.includes('CROSS-REFERENCE'))
    if (start === -1) return ''
    const rest = lines.slice(start)
    const end = rest.findIndex((l, i) => i > 0 && l.trim() === '//')
    return (end === -1 ? rest : rest.slice(0, end)).join('\n')
  }

  it('all three modules exist at the paths the map names', () => {
    for (const p of PATHS) expect(fs.existsSync(path.join(process.cwd(), p)), `${p} moved — update the cross-reference in all three`).toBe(true)
  })

  it.each(PATHS)('%s carries a cross-reference COMMENT naming BOTH of the other two by current path', (self) => {
    const comments = commentsOnly(read(self))
    expect(comments).toContain('CROSS-REFERENCE')
    for (const other of PATHS.filter((p) => p !== self)) {
      expect(comments, `${self} does not name ${other} in a comment`).toContain(other)
    }
  })

  it('the plant: a module whose comment omits a sibling would be caught', () => {
    const planted = '// CROSS-REFERENCE\n//   lib/studio/verify.ts\n'
    expect(commentsOnly(planted)).not.toContain('lib/signals/triage/verify.ts')
  })
})

describe('AGENCY-CLAIMS-FLAGGED-NEVER-EDITED (constraint 18, Tier 3) — no write path from the verifier to posts.content', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'campaigns', 'verify-claims.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])

  it('imports no database, supabase or posts module (only the bound-evidence TYPE, the claim TYPE and a db TYPE)', () => {
    expect(imports.sort()).toEqual(['@/lib/ai/prompts/formats/schemas', '@/lib/ai/wrap-evidence', '@/lib/db/types', '@sentry/nextjs'])
    expect(code).toMatch(/import type \{ BoundEvidence \}/)
    expect(code).toMatch(/import type \{ PersistedClaimCheck \}/)
    expect(code).toMatch(/import type \{ Claim \}/)
  })

  it('contains no write verb, no table access, no console.*', () => {
    expect(code).not.toMatch(/\.(insert|upsert|update|delete|rpc|from)\s*\(/)
    expect(code).not.toMatch(/\bconsole\./)
    expect(code).not.toMatch(/createServiceRoleClient|supabase/i)
  })

  it('generate.ts feeds the verdict ONLY into ai_generation_metadata — posts.content is the joined draft, untouched', () => {
    const gen = fs.readFileSync(path.join(process.cwd(), 'lib', 'campaigns', 'generate.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect([...gen.matchAll(/\bverifyClaims\s*\(/g)]).toHaveLength(1)
    expect([...gen.matchAll(/\btoPersistedClaimCheck\s*\(/g)]).toHaveLength(1)
    expect(gen).toMatch(/content: renderedContent,/)
    // the only place claimCheck is assigned is inside the metadata object literal, after generatedAt
    expect(gen).toMatch(/generatedAt,\s*\.\.\.\(hasEvidenceCorpus === null/)
  })
})

describe('the brands have real runtime initializers (Session 31 BLOCKER-1: an ambient `declare const` throws at runtime)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  it('verify-claims.ts and wrap-evidence.ts mint their brands with Symbol(...) and never declare-only', () => {
    const v = strip(fs.readFileSync(path.join(process.cwd(), 'lib', 'campaigns', 'verify-claims.ts'), 'utf8'))
    const w = strip(fs.readFileSync(path.join(process.cwd(), 'lib', 'ai', 'wrap-evidence.ts'), 'utf8'))
    expect(v).toMatch(/const citedBrand: unique symbol = Symbol\(/)
    expect(w).toMatch(/const boundEvidenceBrand: unique symbol = Symbol\(/)
    expect(v).not.toMatch(/declare const/)
    expect(w).not.toMatch(/declare const [a-zA-Z]*Brand/)
  })

  it('the brand is NOT exported (no other module can mint one)', () => {
    const v = fs.readFileSync(path.join(process.cwd(), 'lib', 'campaigns', 'verify-claims.ts'), 'utf8')
    expect(v).not.toMatch(/export (const|\{[^}]*)\bcitedBrand\b/)
    const w = fs.readFileSync(path.join(process.cwd(), 'lib', 'ai', 'wrap-evidence.ts'), 'utf8')
    expect(w).not.toMatch(/export (const|\{[^}]*)\bboundEvidenceBrand\b/)
  })
})
