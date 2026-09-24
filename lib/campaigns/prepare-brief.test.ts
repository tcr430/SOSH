import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/campaigns/brief', () => ({ assembleBrief: vi.fn(), critiqueBrief: vi.fn() }))
vi.mock('@/lib/campaigns/plan-brief', () => ({ planBrief: vi.fn() }))

import * as Sentry from '@sentry/nextjs'
import { assembleBrief, critiqueBrief } from '@/lib/campaigns/brief'
import { planBrief } from '@/lib/campaigns/plan-brief'
import { prepareBriefForCampaign } from './prepare-brief'

// ADR 0017 §11 + ADR 0027 §2.7/§5.4 (K2.12) — the request-path brief pipeline. Assemble, then the critique and the
// planner CONCURRENTLY; never throws; the planner is wired here and only here.
//
// SHARED-FUNCTION CALLERS (ADR 0015), each `git grep`-ed at K2.12:
//   prepareBriefForCampaign <- app/[locale]/(dashboard)/campaigns/new/actions.ts (createCampaignAction), the ONE
//     production caller; its wiring is asserted in that file's actions.test.ts.
//   planBrief <- this module only (Tier-3 scan below).
//   assembleBrief <- this module, lib/campaigns/promote.ts, lib/signals/seed.ts. The two worker callers are UNCHANGED
//     and still get no planner (AGENCY-PLANNER-REQUEST-PATH-ONLY, scanned in planner/__tests__/source-scans.test.ts).
//   critiqueBrief <- this module and the recritique/apply actions in campaigns/[id]/brief/plan-actions.ts.

const client = {} as SupabaseClient
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(assembleBrief).mockResolvedValue({} as never)
  vi.mocked(critiqueBrief).mockResolvedValue({} as never)
  vi.mocked(planBrief).mockResolvedValue({ status: 'ok', reason: null, proposalCount: 0, droppedCount: 0 })
})

describe('prepareBriefForCampaign — the happy path', () => {
  it("assembles FIRST, then critiques and plans, the planner on the caller's client and the campaign id", async () => {
    const result = await prepareBriefForCampaign(client, CAMPAIGN_ID)
    expect(result).toEqual({ briefReady: true, critiqued: true })

    expect(assembleBrief).toHaveBeenCalledWith(CAMPAIGN_ID)
    expect(critiqueBrief).toHaveBeenCalledWith(CAMPAIGN_ID)
    expect(planBrief).toHaveBeenCalledWith(client, CAMPAIGN_ID)

    const assembleOrder = vi.mocked(assembleBrief).mock.invocationCallOrder[0]
    expect(vi.mocked(critiqueBrief).mock.invocationCallOrder[0]).toBeGreaterThan(assembleOrder)
    expect(vi.mocked(planBrief).mock.invocationCallOrder[0]).toBeGreaterThan(assembleOrder)
  })

  it('runs the critique and the planner CONCURRENTLY: the planner starts before a slow critique finishes', async () => {
    const slowCritique = deferred<never>()
    vi.mocked(critiqueBrief).mockReturnValue(slowCritique.promise)
    const run = prepareBriefForCampaign(client, CAMPAIGN_ID)
    // The critique is now pending and unresolved.
    await vi.waitFor(() => expect(critiqueBrief).toHaveBeenCalled())
    expect(planBrief, 'the planner must not wait for the critique').toHaveBeenCalled()
    slowCritique.resolve({} as never)
    await expect(run).resolves.toEqual({ briefReady: true, critiqued: true })
  })

  it('does not start the critique or the planner until Stage A has produced a brief', async () => {
    const slowAssemble = deferred<never>()
    vi.mocked(assembleBrief).mockReturnValue(slowAssemble.promise)
    const run = prepareBriefForCampaign(client, CAMPAIGN_ID)
    await Promise.resolve()
    expect(planBrief).not.toHaveBeenCalled()
    expect(critiqueBrief).not.toHaveBeenCalled()
    slowAssemble.resolve({} as never)
    await run
    expect(planBrief).toHaveBeenCalledTimes(1)
  })
})

describe('prepareBriefForCampaign — it never throws, and each failure leaves the state the surface already renders', () => {
  it('Stage A fails: no brief, neither the critique nor the planner runs, the campaign is left as it was', async () => {
    vi.mocked(assembleBrief).mockRejectedValue(new Error('provider down'))
    await expect(prepareBriefForCampaign(client, CAMPAIGN_ID)).resolves.toEqual({ briefReady: false })
    expect(critiqueBrief).not.toHaveBeenCalled()
    expect(planBrief).not.toHaveBeenCalled()
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { campaign_id: CAMPAIGN_ID, phase: 'prepare-brief-assemble' },
    })
  })

  it('the critique fails: the brief exists and the planner STILL ran (the review surface offers a retry for a draft brief)', async () => {
    vi.mocked(critiqueBrief).mockRejectedValue(new Error('rubric failed'))
    await expect(prepareBriefForCampaign(client, CAMPAIGN_ID)).resolves.toEqual({ briefReady: true, critiqued: false })
    expect(planBrief).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { campaign_id: CAMPAIGN_ID, phase: 'prepare-brief-critique' },
    })
  })

  it('a planner fault (planBrief is documented never to throw) can never fail the campaign or the critique', async () => {
    vi.mocked(planBrief).mockRejectedValue(new Error('unexpected'))
    await expect(prepareBriefForCampaign(client, CAMPAIGN_ID)).resolves.toEqual({ briefReady: true, critiqued: true })
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { campaign_id: CAMPAIGN_ID, phase: 'prepare-brief-plan' },
    })
  })

  it('both the critique and the planner failing still resolves, reporting the critique as not done', async () => {
    vi.mocked(critiqueBrief).mockRejectedValue(new Error('a'))
    vi.mocked(planBrief).mockRejectedValue(new Error('b'))
    await expect(prepareBriefForCampaign(client, CAMPAIGN_ID)).resolves.toEqual({ briefReady: true, critiqued: false })
  })
})

// ═══ Tier 3 — the planner is wired HERE AND ONLY HERE, and this module acquires no service-role client ═══════════════
// AGENCY-PLANNER-REQUEST-PATH-ONLY (constraint 9). planner/__tests__/source-scans.test.ts already forbids any
// service-role-acquiring module from importing the planner and pins the two worker callers. This adds the positive
// half: exactly one production module imports lib/campaigns/plan-brief, and it is this request-path one.

const ROOT = process.cwd()

function stripComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

export function importsPlanBrief(source: string): boolean {
  return /(?:from|import)\s*\(?\s*['"](?:@\/lib\/campaigns\/plan-brief|(?:\.\.?\/)+plan-brief)['"]/.test(stripComments(source))
}

export function acquiresServiceRole(source: string): boolean {
  return /supabase\/service['"]/.test(stripComments(source))
}

function collectProdTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectProdTs(full))
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

describe('AGENCY-PLANNER-REQUEST-PATH-ONLY — the positive half (Tier 3, K2.12)', () => {
  it('the detectors flag an import of the planner recorder, static or relative, and a service-role acquisition (planted)', () => {
    expect(importsPlanBrief("import { planBrief } from '@/lib/campaigns/plan-brief'")).toBe(true)
    expect(importsPlanBrief("import { planBrief } from './plan-brief'")).toBe(true)
    expect(importsPlanBrief("const m = await import('@/lib/campaigns/plan-brief')")).toBe(true)
    expect(acquiresServiceRole("const { createServiceRoleClient } = await import('@/lib/supabase/service')")).toBe(true)
  })

  it('the detectors ignore comments and unrelated modules (planted negatives)', () => {
    expect(importsPlanBrief("// import { planBrief } from '@/lib/campaigns/plan-brief'\nconst x = 1")).toBe(false)
    expect(importsPlanBrief("import { x } from '@/lib/campaigns/brief'")).toBe(false)
    expect(acquiresServiceRole("import { createClient } from '@/lib/supabase/server'")).toBe(false)
  })

  it('exactly one production module imports plan-brief, and it is prepare-brief.ts, which acquires no service-role client', () => {
    const files = ['lib', 'app'].flatMap((d) => collectProdTs(path.join(ROOT, d)))
    expect(files.length, 'scanned suspiciously few files').toBeGreaterThan(200)

    const importers = files
      .filter((f) => importsPlanBrief(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    expect(importers).toEqual(['lib/campaigns/prepare-brief.ts'])

    expect(acquiresServiceRole(fs.readFileSync(path.join(ROOT, 'lib/campaigns/prepare-brief.ts'), 'utf8'))).toBe(false)
  })
})
