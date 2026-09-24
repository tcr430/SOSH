import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/db/campaign-plan-proposals', () => ({ applyBriefProposalsRpc: vi.fn() }))

import * as Sentry from '@sentry/nextjs'
import { applyBriefProposalsRpc } from '@/lib/db/campaign-plan-proposals'
import { CampaignBriefContentSchema } from '@/lib/ai/prompts/brief'
import { RoleSequenceSchema, findDuplicateOrders, validateRoleSequence, ROLE_SEQUENCE_ENTRY_SCHEMA } from './role-sequence'
import { applyRatifiedProposals } from './apply-proposals'
import { checkRoleCoverage } from './consistency'

// ADR 0027 §5.9 (Session 34 K2.8) — AGENCY-ROLE-SEQUENCE-ORDER-UNIQUE (27) and AGENCY-FROZEN-BRIEF-CONTRACT-INTACT
// (26, Tier-2 half).
//
// SHARED-FUNCTION CALLERS (ADR 0015), per import path of the shared schema:
//   before the extraction: ROLE_SEQUENCE_ENTRY_SCHEMA was a PRIVATE const in lib/ai/prompts/brief.ts, used only
//     by CampaignBriefContentSchema (importers of that: lib/ai/prompts/brief.test.ts, brief-hypothesis.test.ts,
//     lib/campaigns/brief.ts via briefAssemblyPrompt);
//   after: RoleSequenceSchema is imported by (1) lib/ai/prompts/brief.ts and (2) lib/campaigns/role-sequence.ts's
//     own validateRoleSequence, which is the only thing lib/campaigns/apply-proposals.ts calls.
//   Tests per import path: (1) the 'prompt path' describe below; (2) the 'apply path' describe below. A fix
//     applied to one and not the other is caught by the scan at the bottom.
//   checkRoleCoverage: ONE caller (generate.ts), UNCHANGED, covered by consistency.test.ts and generate.test.ts.

const entry = (order: number, role = 'anchor_thesis', platform = 'linkedin', angle = `angle ${order}`) => ({ order, role, platform, angle })
const brief = (roleSequence: unknown[]) => ({
  narrative: 'n',
  proofPlan: 'p',
  pinnedEvidence: [],
  roleSequence,
})

describe('the shared role-sequence schema', () => {
  it('accepts a well-formed sequence, and a sequence with a GAP (contiguity is deliberately not required)', () => {
    expect(RoleSequenceSchema.safeParse([entry(0), entry(1), entry(2)]).success).toBe(true)
    expect(RoleSequenceSchema.safeParse([entry(0), entry(3), entry(7)]).success).toBe(true)
  })

  it('REJECTS a duplicate order', () => {
    const r = RoleSequenceSchema.safeParse([entry(0), entry(3), entry(3, 'follow_up')])
    expect(r.success).toBe(false)
    expect(r.success ? '' : r.error.issues[0].message).toMatch(/unique `order`/)
  })

  it('still rejects an empty sequence and an out-of-vocabulary role / platform / negative / fractional order', () => {
    expect(RoleSequenceSchema.safeParse([]).success).toBe(false)
    expect(ROLE_SEQUENCE_ENTRY_SCHEMA.safeParse(entry(0, 'hype_man')).success).toBe(false)
    expect(ROLE_SEQUENCE_ENTRY_SCHEMA.safeParse(entry(0, 'follow_up', 'myspace')).success).toBe(false)
    expect(ROLE_SEQUENCE_ENTRY_SCHEMA.safeParse(entry(-1)).success).toBe(false)
    expect(ROLE_SEQUENCE_ENTRY_SCHEMA.safeParse(entry(1.5)).success).toBe(false)
  })

  it('findDuplicateOrders names every offender once, ascending', () => {
    expect(findDuplicateOrders([{ order: 2 }, { order: 1 }, { order: 2 }, { order: 2 }, { order: 1 }])).toEqual([1, 2])
    expect(findDuplicateOrders([{ order: 0 }, { order: 1 }])).toEqual([])
  })
})

describe('import path 1 — the brief prompt schema (CampaignBriefContentSchema)', () => {
  it('REJECTS a brief whose roleSequence carries a duplicate order', () => {
    expect(CampaignBriefContentSchema.safeParse(brief([entry(0), entry(1), entry(1, 'customer_proof')])).success).toBe(false)
  })
  it('accepts the same brief with the duplicate removed (positive control)', () => {
    expect(CampaignBriefContentSchema.safeParse(brief([entry(0), entry(1)])).success).toBe(true)
  })
})

describe('import path 2 — the apply path (validateRoleSequence / applyRatifiedProposals)', () => {
  const args = { businessId: 'b', briefId: 'br', expectedVersion: 1, userId: 'u', proposalIds: ['p1'] }
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('validateRoleSequence REJECTS a duplicate order, with the same message as the prompt path', () => {
    const r = validateRoleSequence([entry(0), entry(0, 'follow_up')])
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.message).toMatch(/unique `order`/)
  })

  it('applyRatifiedProposals returns invalid_result (and reports to Sentry) when the applied brief carries a duplicate order', async () => {
    vi.mocked(applyBriefProposalsRpc).mockResolvedValue({
      outcome: 'ok',
      acceptedIds: ['p1'],
      brief: { content: { roleSequence: [entry(0), entry(0, 'follow_up')] } },
    } as never)
    const result = await applyRatifiedProposals(args)
    expect(result.outcome).toBe('invalid_result')
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('applyRatifiedProposals passes a valid applied brief straight through', async () => {
    const ok = { outcome: 'ok', acceptedIds: ['p1'], brief: { content: { roleSequence: [entry(0), entry(1)] } } }
    vi.mocked(applyBriefProposalsRpc).mockResolvedValue(ok as never)
    expect(await applyRatifiedProposals(args)).toBe(ok)
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it.each([
    [{ outcome: 'frozen' }],
    [{ outcome: 'concurrent_edit' }],
    [{ outcome: 'not_found' }],
    [{ outcome: 'no_proposals_applied' }],
    [{ outcome: 'stale_target_order', proposalId: 'p1' }],
    [{ outcome: 'conflicting_proposals', proposalId: 'p1' }],
  ])('a typed refusal %j is passed through untouched and never validated', async (refusal) => {
    vi.mocked(applyBriefProposalsRpc).mockResolvedValue(refusal as never)
    expect(await applyRatifiedProposals(args)).toBe(refusal)
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})

describe('the generate.ts angle-lookup scenario has no duplicate left to mis-resolve', () => {
  // generate.ts: frozenBrief.content.roleSequence.find((r) => r.order === g.order)?.angle — FIRST match wins.
  const lookup = (seq: Array<{ order: number; angle: string }>, order: number) => seq.find((r) => r.order === order)?.angle

  it('with a duplicate order the lookup resolves the WRONG entry (the defect) — and that sequence is now unrepresentable', () => {
    const dup = [entry(0), entry(3, 'customer_proof', 'linkedin', 'first'), entry(3, 'follow_up', 'twitter', 'second')]
    expect(lookup(dup, 3)).toBe('first') // the second post would record 'first' — the corruption
    expect(RoleSequenceSchema.safeParse(dup).success).toBe(false)
    expect(CampaignBriefContentSchema.safeParse(brief(dup)).success).toBe(false)
    expect(validateRoleSequence(dup).ok).toBe(false)
  })

  it('every entry of a schema-valid sequence resolves to ITS OWN angle', () => {
    const seq = [entry(0), entry(1), entry(4)]
    expect(RoleSequenceSchema.safeParse(seq).success).toBe(true)
    for (const e of seq) expect(lookup(seq, e.order)).toBe(e.angle)
  })
})

describe('AGENCY-FROZEN-BRIEF-CONTRACT-INTACT — positional coverage survives a ratified apply (constraint 26, Tier 2)', () => {
  // Shapes exactly as apply_brief_proposals writes them: `order` re-derived from array position, so contiguous.
  const original = [entry(0, 'anchor_thesis'), entry(1, 'customer_proof'), entry(2, 'follow_up')]
  const afterSubstitute = [entry(0, 'anchor_thesis'), entry(1, 'objection_response'), entry(2, 'follow_up')]
  const afterDrop = [entry(0, 'anchor_thesis'), entry(1, 'follow_up')] // entry 1 dropped, 2 renumbered to 1
  const afterReorder = [entry(0, 'anchor_thesis'), entry(1, 'follow_up'), entry(2, 'customer_proof')]

  it.each([
    ['the original', original],
    ['a ratified substitute', afterSubstitute],
    ['a ratified drop (renumbered)', afterDrop],
    ['a ratified reorder', afterReorder],
  ])('%s: every entry generates a post and coverage passes', (_label, seq) => {
    expect(validateRoleSequence(seq).ok).toBe(true)
    // generate.ts pushes `order: entry.order` from the same entry that produced the post.
    const generated = seq.map((e) => ({ order: e.order }))
    expect(checkRoleCoverage(generated, seq as never)).toEqual({ ok: true, missingOrders: [] })
  })

  it('coverage still REDDENS on a genuinely missing entry after a ratified drop (the check was not neutered)', () => {
    expect(checkRoleCoverage([{ order: 0 }], afterDrop as never)).toEqual({ ok: false, missingOrders: [1] })
  })
})

describe('both import paths use the ONE schema — a scan, so a fix to one path cannot be missing from the other', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('lib/ai/prompts/brief.ts imports RoleSequenceSchema from the neutral module and defines no order schema of its own', () => {
    const src = stripComments(read('lib/ai/prompts/brief.ts'))
    expect(src).toMatch(/import\s*\{\s*RoleSequenceSchema\s*\}\s*from\s*'@\/lib\/campaigns\/role-sequence'/)
    expect(src).toContain('roleSequence: RoleSequenceSchema')
    expect(/\border\s*:\s*z\./.test(src), 'brief.ts defines its own `order` schema again').toBe(false)
  })

  it('lib/campaigns/apply-proposals.ts validates through the neutral module', () => {
    const src = stripComments(read('lib/campaigns/apply-proposals.ts'))
    expect(src).toMatch(/import\s*\{\s*validateRoleSequence\s*\}\s*from\s*'@\/lib\/campaigns\/role-sequence'/)
    expect(src).toMatch(/validateRoleSequence\(/)
  })

  it('no production file other than the neutral module defines an `order: z.number()` role-sequence entry', () => {
    const roots = ['lib', 'app']
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.next') continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const rel = path.relative(process.cwd(), full).replace(/\\/g, '/')
          if (rel === 'lib/campaigns/role-sequence.ts') continue
          if (/\border\s*:\s*z\.number\(\)\.int\(\)\.min\(0\)/.test(stripComments(fs.readFileSync(full, 'utf8')))) offenders.push(rel)
        }
      }
    }
    for (const r of roots) walk(path.join(process.cwd(), r))
    expect(offenders).toEqual([])
  })
})
