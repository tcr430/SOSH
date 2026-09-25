// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const holder = vi.hoisted(() => ({ locale: 'en' as 'en' | 'pt' | 'es' }))

vi.mock('next-intl', async () => {
  const { makeTranslator } = await import('@/lib/i18n/__test-utils__/translator')
  return { useTranslations: (namespace: string) => makeTranslator(holder.locale, namespace) }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./plan-actions', () => ({
  applyPlanProposalsAction: vi.fn(),
  decidePlanProposalAction: vi.fn(),
  recritiqueBriefAction: vi.fn(),
}))

import { PlanReviewPanel, type PlanProposalView, type RoleSequenceView } from './PlanReviewPanel'
import { LOCALES, FORBIDDEN_VOCABULARY } from '@/lib/i18n/__test-utils__/translator'
import { PLAN_ANALYSIS_REASONS, type PlanAnalysisReason } from '@/lib/db/types'

// ADR 0027 §8 (Session 34 K2.10). Tier 2, driven from the PERSISTED plan_analysis_status (constraint 13's rendering
// half) and rendered against the REAL en/pt/es strings.
//
// SHARED-FUNCTION CALLERS: PlanReviewPanel has ONE caller, brief/page.tsx (tested in page.test.tsx: it receives the
// persisted column, the bounded proposal list, and is keyed on brief id + version). Its three Server Actions each
// have one caller here (plan-actions.test.ts covers the actions themselves).

const ROLE_SEQUENCE: RoleSequenceView = [
  { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'the thesis' },
  { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'a customer story' },
  { order: 2, role: 'follow_up', platform: 'twitter', angle: 'next steps' },
]

const proposal = (over: Partial<PlanProposalView> = {}): PlanProposalView => ({
  id: crypto.randomUUID(),
  kind: 'drop',
  targetOrder: 1,
  proposedRole: null,
  proposedOrder: null,
  reason: 'No customer evidence exists for this post.',
  status: 'pending',
  supersededReason: null,
  briefVersion: 1,
  ...over,
})

type Props = React.ComponentProps<typeof PlanReviewPanel>
const baseProps = (over: Partial<Props> = {}): Props => ({
  campaignId: 'camp-1',
  briefVersion: 1,
  briefStatus: 'critiqued',
  planStatus: 'ok',
  planReason: null,
  proposals: [proposal()],
  roleSequence: ROLE_SEQUENCE,
  canAuthor: true,
  ...over,
})

let root: Root | null = null
let container: HTMLElement | null = null

async function render(props: Props, locale: 'en' | 'pt' | 'es' = 'en'): Promise<HTMLElement> {
  holder.locale = locale
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<PlanReviewPanel {...props} />)
  })
  return container
}

async function unmount() {
  if (root) await act(async () => root!.unmount())
  container?.remove()
  root = null
  container = null
}

afterEach(async () => {
  await unmount()
  holder.locale = 'en'
})

const stateLine = (c: HTMLElement) => c.querySelector('#plan-review-heading')!.nextElementSibling!.textContent

describe('§8.2 — the FIVE planner states are five distinct sentences, driven from the persisted column', () => {
  const cases: Array<[string, Partial<Props>]> = [
    ['not_run', { planStatus: 'not_run', proposals: [] }],
    ['proposed n', { planStatus: 'ok', proposals: [proposal(), proposal({ targetOrder: 2 })] }],
    ['proposed nothing', { planStatus: 'ok', proposals: [] }],
    ['unavailable', { planStatus: 'unavailable', planReason: 'wall_clock_exceeded', proposals: [] }],
    ['capped', { planStatus: 'capped', planReason: 'daily_cap', proposals: [] }],
  ]

  it('each state renders its own sentence, and no two are the same', async () => {
    const lines: string[] = []
    for (const [, over] of cases) {
      const c = await render(baseProps(over))
      lines.push(stateLine(c)!)
      await unmount()
    }
    expect(new Set(lines).size).toBe(5)
    expect(lines[0]).toMatch(/No plan analysis was run/)
    expect(lines[1]).toMatch(/proposed 2 changes/)
    expect(lines[2]).toMatch(/proposed no changes/)
    expect(lines[3]).toMatch(/unavailable/i)
    expect(lines[4]).toMatch(/paused/i)
    expect(lines[4]).toMatch(/daily limit/)
  })

  it("D10 (MINOR-3): status not_run WITH proposal rows renders the proposals and a distinct 'not recorded' line, never 'No plan analysis was run'", async () => {
    for (const locale of LOCALES) {
      const c = await render(baseProps({ planStatus: 'not_run', proposals: [proposal(), proposal({ targetOrder: 2 })] }), locale)
      const line = stateLine(c)!
      expect(line, locale).not.toContain('⟦missing')
      if (locale === 'en') {
        expect(line).toMatch(/proposed 2 changes/)
        expect(line).toMatch(/not recorded/)
        expect(line).not.toMatch(/No plan analysis was run/)
      }
      expect(c.querySelectorAll('li').length, locale).toBeGreaterThan(0)
      await unmount()
    }
  })

  it("'unavailable' and 'proposed nothing' both have ZERO proposal rows yet read differently (the whole point of §3.3)", async () => {
    const nothing = await render(baseProps({ planStatus: 'ok', proposals: [] }))
    const nothingText = stateLine(nothing)
    await unmount()
    const unavailable = await render(baseProps({ planStatus: 'unavailable', planReason: 'provider_error', proposals: [] }))
    expect(stateLine(unavailable)).not.toBe(nothingText)
    expect(unavailable.querySelectorAll('li')).toHaveLength(0)
  })

  it('the unavailable line names the reason, and EVERY one of the 14 closed reasons has a real (non-missing) string in all three locales', async () => {
    for (const locale of LOCALES) {
      for (const reason of PLAN_ANALYSIS_REASONS) {
        const c = await render(baseProps({ planStatus: 'unavailable', planReason: reason, proposals: [] }), locale)
        expect(stateLine(c), `${locale}/${reason}`).not.toContain('⟦missing')
        await unmount()
      }
    }
  })

  it('a null reason on an unavailable row degrades to the generic internal reason, never to a blank or a raw key', async () => {
    const c = await render(baseProps({ planStatus: 'unavailable', planReason: null as PlanAnalysisReason | null, proposals: [] }))
    expect(stateLine(c)).toMatch(/something went wrong on our side/)
  })
})

describe('§8.2 — proposal states', () => {
  it('pending proposals are selectable and rejectable; each row names its position and the change', async () => {
    const c = await render(baseProps({ proposals: [proposal({ kind: 'substitute', proposedRole: 'objection_response' })] }))
    expect(c.textContent).toContain('Position 2')
    expect(c.textContent).toContain('Change its role to')
    expect(c.querySelector('input[type="checkbox"][name="proposalId"]')).not.toBeNull()
    expect(c.textContent).toContain('Reject')
  })

  it('accepted / rejected / superseded render in "Already decided", and superseded says WHY (moved on vs approved)', async () => {
    const c = await render(
      baseProps({
        briefStatus: 'approved',
        proposals: [
          proposal({ status: 'accepted' }),
          proposal({ status: 'rejected', targetOrder: 0 }),
          proposal({ status: 'superseded', supersededReason: 'version_advanced', targetOrder: 2 }),
          proposal({ status: 'superseded', supersededReason: 'brief_frozen', targetOrder: 2, kind: 'reorder', proposedOrder: 0 }),
        ],
      }),
    )
    const text = c.textContent!
    expect(text).toContain('Already decided')
    expect(text).toContain('Accepted')
    expect(text).toContain('Rejected')
    expect(text).toContain('The brief moved on after this was proposed.')
    expect(text).toContain('The brief was approved, so this can no longer be applied.')
    // nothing decided is selectable
    expect(c.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('shows the CURRENT entry for a same-version proposal, and omits it for an older-version one (its position no longer means that entry)', async () => {
    const c = await render(baseProps({ proposals: [proposal({ targetOrder: 1, briefVersion: 1 }), proposal({ targetOrder: 0, briefVersion: 0, status: 'superseded', supersededReason: 'version_advanced' })] }))
    expect(c.textContent).toContain('a customer story')
    expect(c.textContent).not.toContain('the thesis')
  })
})

describe("the planner's assessment: labelled, provisional, and PLAIN TEXT", () => {
  it('every proposal\'s reason is under the "The planner\'s assessment" label, inside a blockquote', async () => {
    const c = await render(baseProps({ proposals: [proposal(), proposal({ targetOrder: 2, reason: 'A second reason.' })] }))
    const quotes = c.querySelectorAll('blockquote')
    expect(quotes).toHaveLength(2)
    for (const q of quotes) expect(q.textContent).toContain("The planner's assessment")
  })

  it('carries NO tick, badge or verdict glyph beside the assessment (it has no oracle)', async () => {
    const c = await render(baseProps())
    const q = c.querySelector('blockquote')!
    expect(q.textContent).not.toMatch(/[✓✔☑]/)
    expect(q.querySelector('svg, img, [class*="badge"]')).toBeNull()
  })

  it('renders a hostile reason as LITERAL TEXT: no element is created from HTML, and markdown is not interpreted', async () => {
    const hostile = '<img src=x onerror="alert(1)"> ![tracker](https://evil.example/p.png) **bold** <script>alert(2)</script>'
    const c = await render(baseProps({ proposals: [proposal({ reason: hostile })] }))
    expect(c.querySelector('img, script')).toBeNull()
    expect(c.querySelector('strong, b')).toBeNull()
    expect(c.querySelector('blockquote')!.textContent).toContain(hostile)
    expect(c.innerHTML).toContain('&lt;img')
  })

  it('the margin rule is a 1px dashed rule, not a side-stripe accent wider than 1px (impeccable product-register ban)', async () => {
    const c = await render(baseProps())
    const cls = c.querySelector('blockquote')!.className
    expect(cls).toMatch(/\bborder-l\b/)
    expect(cls).not.toMatch(/\bborder-l-(2|4|8)\b/)
    expect(cls).toMatch(/\bborder-dashed\b/)
  })
})

describe('NO bulk accept-all: a ratification round is an explicit selection', () => {
  it('there is no select-all and no accept-all control, in any locale', async () => {
    const banned = /(accept|select|apply)\s+all|(aceitar|selecionar|aplicar)\s+tod|(aceptar|seleccionar|aplicar)\s+tod/i
    for (const locale of LOCALES) {
      const c = await render(baseProps({ proposals: [proposal(), proposal({ targetOrder: 2 })] }), locale)
      const labels = [...c.querySelectorAll('button, label, summary, [role="button"]')].map((n) => n.textContent ?? '')
      for (const label of labels) expect(banned.test(label), `${locale}: "${label}"`).toBe(false)
      await unmount()
    }
  })

  it('Apply is disabled until at least one proposal is selected, shows the count, and is wired to the round form', async () => {
    const c = await render(baseProps({ proposals: [proposal(), proposal({ targetOrder: 2 })] }))
    const apply = () => [...c.querySelectorAll('button')].find((b) => /^Apply selected/.test(b.textContent ?? ''))!
    expect(apply().disabled).toBe(true)
    expect(apply().textContent).toBe('Apply selected (0)')
    expect(c.textContent).toContain('Select at least one proposal to apply.')

    const boxes = c.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="proposalId"]')
    await act(async () => boxes[0].click())
    expect(apply().disabled).toBe(false)
    expect(apply().textContent).toBe('Apply selected (1)')
    await act(async () => boxes[1].click())
    expect(apply().textContent).toBe('Apply selected (2)')
    await act(async () => boxes[0].click())
    expect(apply().textContent).toBe('Apply selected (1)')

    // every checkbox belongs to the ONE apply form (HTML `form` attribute), which carries the expected version
    const form = apply().closest('form')!
    for (const b of boxes) expect(b.getAttribute('form')).toBe(form.id)
    expect((form.querySelector('input[name="expectedVersion"]') as HTMLInputElement).value).toBe('1')
    expect(c.textContent).toContain('Nothing is applied until you press Apply.')
  })

  it('each checkbox has a DISTINCT accessible name that includes its position (three "Drop this post" boxes must not announce identically)', async () => {
    const c = await render(baseProps({ proposals: [proposal({ targetOrder: 0 }), proposal({ targetOrder: 1 }), proposal({ targetOrder: 2 })] }))
    const names = [...c.querySelectorAll('input[type="checkbox"]')].map((box) =>
      box.getAttribute('aria-labelledby')!.split(' ').map((id) => c.querySelector(`[id="${id}"]`)!.textContent).join(' '),
    )
    expect(new Set(names).size).toBe(3)
    expect(names[0]).toContain('Position 1')
    expect(names[0]).toContain('Drop this post')
  })

  it('Reject is a per-proposal form whose decision is the LITERAL "rejected" (accepting happens only inside a round)', async () => {
    const p = proposal()
    const c = await render(baseProps({ proposals: [p] }))
    const decision = c.querySelector('input[name="decision"]') as HTMLInputElement
    expect(decision.value).toBe('rejected')
    expect((c.querySelector('input[name="proposalId"][type="hidden"]') as HTMLInputElement).value).toBe(p.id)
    expect(c.querySelectorAll('input[name="decision"]')).toHaveLength(1)
  })
})

describe('capability and brief state gate the controls (UX echo; the RPC is the boundary)', () => {
  it('a viewer sees the proposals and their reasons but no checkbox, no Reject and no Apply', async () => {
    const c = await render(baseProps({ canAuthor: false }))
    expect(c.textContent).toContain('Drop this post')
    expect(c.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect(c.textContent).not.toContain('Reject')
    expect([...c.querySelectorAll('button')].some((b) => /Apply/.test(b.textContent ?? ''))).toBe(false)
  })

  it('a brief that is not at the critiqued checkpoint offers no selection (nothing to apply yet)', async () => {
    const c = await render(baseProps({ briefStatus: 'draft' }))
    expect(c.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
  })
})

describe('§8.2 transient state: Approve is absent WITH AN EXPLANATION, never silently gone', () => {
  it('a draft brief explains why Approve is hidden and offers to run the check again', async () => {
    const c = await render(baseProps({ briefStatus: 'draft', proposals: [] }))
    expect(c.textContent).toContain('Approve is hidden while the brief is re-checked')
    expect(c.textContent).toContain('Approve returns as soon as the new check is done.')
    expect([...c.querySelectorAll('button')].some((b) => b.textContent === 'Run the check again')).toBe(true)
  })

  it('a critiqued brief shows no such explanation (Approve is present)', async () => {
    const c = await render(baseProps({ briefStatus: 'critiqued' }))
    expect(c.textContent).not.toContain('Approve is hidden')
  })

  it('a viewer sees the explanation but not the retry', async () => {
    const c = await render(baseProps({ briefStatus: 'draft', canAuthor: false }))
    expect(c.textContent).toContain('Approve is hidden')
    expect([...c.querySelectorAll('button')].some((b) => b.textContent === 'Run the check again')).toBe(false)
  })

  it('the explanation is not a nested card (hairline, not a bordered box inside the bordered section)', async () => {
    const c = await render(baseProps({ briefStatus: 'draft', proposals: [] }))
    const explanation = [...c.querySelectorAll('[role="status"]')].find((n) => n.textContent?.includes('Approve is hidden'))!
    const tokens = explanation.className.split(/\s+/)
    expect(tokens.some((t) => t.startsWith('rounded'))).toBe(false)
    // whole class tokens: `border-t` (a hairline) is fine, a bare `border` (a full box) is not
    expect(tokens).not.toContain('border')
  })
})

describe('AGENCY-CLAIM-CITED-NOT-SUPPORTED — rendered vocabulary, every state, every locale', () => {
  it('no rendered text on the planner surface contains "verified" / "supported" (or their pt/es equivalents)', async () => {
    const everything = baseProps({
      briefStatus: 'draft',
      planStatus: 'ok',
      proposals: [
        proposal({ kind: 'drop' }),
        proposal({ kind: 'substitute', proposedRole: 'objection_response', targetOrder: 0 }),
        proposal({ kind: 'reorder', proposedOrder: 2, targetOrder: 1 }),
        proposal({ kind: 'request_evidence', targetOrder: 2 }),
        proposal({ status: 'accepted', targetOrder: 0 }),
        proposal({ status: 'rejected', targetOrder: 1 }),
        proposal({ status: 'superseded', supersededReason: 'version_advanced', targetOrder: 2 }),
        proposal({ status: 'superseded', supersededReason: 'brief_frozen', targetOrder: 0 }),
      ],
    })
    const variants: Array<Partial<Props>> = [
      {},
      { planStatus: 'unavailable', planReason: 'provider_error' },
      { planStatus: 'capped' },
      { planStatus: 'not_run', proposals: [] },
      { canAuthor: false },
    ]
    for (const locale of LOCALES) {
      for (const over of variants) {
        const c = await render({ ...everything, ...over }, locale)
        const text = c.textContent!
        expect(text, `${locale}: missing key`).not.toContain('⟦missing')
        expect(FORBIDDEN_VOCABULARY[locale].test(text), `${locale}: "${text.match(FORBIDDEN_VOCABULARY[locale])?.[0]}"`).toBe(false)
        await unmount()
      }
    }
  })
})

describe('accessibility floor', () => {
  it('the section is a labelled region and the heading is an h2', async () => {
    const c = await render(baseProps())
    const section = c.querySelector('section')!
    expect(section.getAttribute('aria-labelledby')).toBe('plan-review-heading')
    expect(c.querySelector('h2#plan-review-heading')).not.toBeNull()
  })

  it('the selection group has a (visually hidden) legend, and the results live region is ALWAYS mounted so announcements land', async () => {
    const c = await render(baseProps())
    expect(c.querySelector('fieldset > legend')).not.toBeNull()
    expect(c.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull()
  })

  it('the checkbox label is a touch target larger than the 16px box (h-8 w-8)', async () => {
    const c = await render(baseProps())
    const label = c.querySelector('label')!
    expect(label.className).toMatch(/\bh-8\b/)
    expect(label.className).toMatch(/\bw-8\b/)
  })
})
