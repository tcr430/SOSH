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
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...rest }, children),
}))
vi.mock('./claim-actions', () => ({ resolveClaimAction: vi.fn() }))

import { ClaimFlags, MarkedPostText, hasOpenClaimFlags, type EvidenceOption } from './ClaimFlags'
import { LOCALES, FORBIDDEN_VOCABULARY } from '@/lib/i18n/__test-utils__/translator'
import type { PersistedClaimCheck } from '@/lib/db/types'

// ADR 0027 §4.6/§4.8/§8 (Session 34 K2.10). Tier 2, rendered against the REAL en/pt/es strings.
//
// SHARED-FUNCTION CALLERS: ClaimFlags / MarkedPostText / hasOpenClaimFlags have ONE caller, ApprovalsInbox.tsx's
// DraftRow (its integration is tested in ApprovalsInbox.test.tsx, describe "claim flags in DraftRow", line 867). resolveClaimAction has one caller, ClaimFlags
// (claim-actions.test.ts).

const POST_ID = '11111111-1111-4111-8111-111111111111'
const CONTENT = 'We cut churn by 42% in Q3. Acme, the fastest tool, agrees. It was a good quarter.'
const S1 = 'We cut churn by 42% in Q3.'
const S2 = 'the fastest tool'
const span = (text: string) => {
  const start = CONTENT.indexOf(text)
  return { start, end: start + text.length }
}

const EVIDENCE: EvidenceOption[] = [
  { id: '22222222-2222-4222-8222-222222222222', snippet: 'Customer A cut churn by 42% last year' },
  { id: '33333333-3333-4333-8333-333333333333', snippet: 'Customer B saved 10 hours a week' },
]

type C = Extract<PersistedClaimCheck, { status: 'checked' }>['claims'][number]
const checked = (claims: C[]): PersistedClaimCheck => ({ status: 'checked', claims })
const supported = (text: string, id = '22222222-2222-4222-8222-222222222222'): C => ({ outcome: 'supported', span: span(text), evidenceMemoryId: id })
const unsupported = (text: string): C => ({ outcome: 'unsupported', span: span(text) })
const fabricated = (text: string): C => ({ outcome: 'fabricated', span: span(text) })

let root: Root | null = null
let container: HTMLElement | null = null

async function mount(node: React.ReactElement, locale: 'en' | 'pt' | 'es' = 'en'): Promise<HTMLElement> {
  holder.locale = locale
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(node))
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

const flags = (check: PersistedClaimCheck | undefined, over: Partial<React.ComponentProps<typeof ClaimFlags>> = {}) => (
  <ClaimFlags postId={POST_ID} content={CONTENT} check={check} evidenceOptions={EVIDENCE} editHref="/en/campaigns/camp-1/posts" {...over} />
)

describe('§8.2 claim states — each is its own sentence', () => {
  it('renders five distinct states: not checked / no claims / no corpus / all cited / n flagged', async () => {
    const texts: string[] = []
    for (const check of [
      undefined,
      { status: 'no_claims' } as PersistedClaimCheck,
      { status: 'no_corpus' } as PersistedClaimCheck,
      checked([supported(S1), supported(S2)]),
      checked([unsupported(S1), supported(S2)]),
    ]) {
      const c = await mount(flags(check))
      texts.push(c.textContent!)
      await unmount()
    }
    expect(new Set(texts).size).toBe(5)
    expect(texts[0]).toContain('were not checked')
    expect(texts[1]).toContain('No checkable claims')
    expect(texts[2]).toContain('No evidence corpus: claims not checked')
    expect(texts[3]).toContain('All 2 claims in this post are cited.')
    expect(texts[4]).toContain('1 cited, 1 without a citation, 0 citing unknown evidence')
  })

  it("the empty-corpus state never reads as a count of unsupported claims (constraint 20's rendering half)", async () => {
    const c = await mount(flags({ status: 'no_corpus' }))
    expect(c.textContent).not.toMatch(/\d/)
    expect(c.textContent).not.toContain('without a citation')
    expect(c.querySelector('button, a, form')).toBeNull()
  })

  it('a post with NO verdict is "not checked", never "clean" — absence is not a pass', async () => {
    const c = await mount(flags(undefined))
    expect(c.textContent).toContain('were not checked')
    expect(c.textContent).not.toMatch(/all .* cited|no checkable/i)
  })

  it('all-cited is quiet text: no tick, no badge, no green', async () => {
    const c = await mount(flags(checked([supported(S1)])))
    expect(c.textContent).not.toMatch(/[✓✔☑]/)
    expect(c.querySelector('svg, img, [class*="badge"], [class*="emerald"], [class*="green"]')).toBeNull()
  })
})

describe('the inline mark: the flagged sentence is read FROM THE POST, never from a model string', () => {
  it('marks each OPEN flagged span in the post text, with a screen-reader prefix (not colour alone)', async () => {
    const c = await mount(<MarkedPostText content={CONTENT} check={checked([unsupported(S1), fabricated(S2)])} />)
    const marks = [...c.querySelectorAll('mark')]
    expect(marks).toHaveLength(2)
    expect(marks.map((m) => m.textContent!.replace('Flagged claim: ', ''))).toEqual([S1, S2])
    for (const m of marks) {
      expect(m.querySelector('.sr-only')!.textContent).toContain('Flagged claim')
      expect(m.className).toMatch(/underline/)
    }
    // the post text is intact: marking never drops or reorders a byte
    expect(c.textContent!.replace(/Flagged claim: /g, '')).toBe(CONTENT)
  })

  it('does NOT mark a cited claim, and does not mark a resolved flag', async () => {
    const resolved: C = { ...unsupported(S2), resolution: { kind: 'dismissed', at: '2026-09-24T00:00:00Z', by: 'u' } }
    const c = await mount(<MarkedPostText content={CONTENT} check={checked([supported(S1), resolved])} />)
    expect(c.querySelectorAll('mark')).toHaveLength(0)
  })

  it('a claim whose text was not located (span null) is not highlighted, but is still LISTED as flagged', async () => {
    const c = await mount(flags(checked([{ outcome: 'unsupported', span: null }])))
    expect(c.textContent).toContain('This claim could not be located in the text.')
    expect(c.textContent).toContain('No citation')
  })

  it('overlapping and out-of-range spans are clamped and de-overlapped, never crashing or duplicating text', async () => {
    const c = await mount(
      <MarkedPostText
        content={CONTENT}
        check={checked([
          { outcome: 'unsupported', span: { start: 0, end: 20 } },
          { outcome: 'unsupported', span: { start: 10, end: 30 } },
          { outcome: 'fabricated', span: { start: CONTENT.length - 5, end: CONTENT.length + 500 } },
        ])}
      />,
    )
    expect(c.textContent!.replace(/Flagged claim: /g, '')).toBe(CONTENT)
  })

  it('a hostile post is rendered as literal text (no element from HTML, no markdown)', async () => {
    const hostile = 'Click <img src=x onerror="alert(1)"> ![t](https://evil.example/x.png) **now**. We grew 900%.'
    const start = hostile.indexOf('We grew 900%.')
    const c = await mount(<MarkedPostText content={hostile} check={checked([{ outcome: 'unsupported', span: { start, end: start + 13 } }])} />)
    expect(c.querySelector('img, script, strong, b')).toBeNull()
    expect(c.innerHTML).toContain('&lt;img')
    expect(c.querySelector('mark')!.textContent).toContain('We grew 900%.')
  })

  it('hasOpenClaimFlags is true only for an UNRESOLVED flagged claim', () => {
    expect(hasOpenClaimFlags(undefined)).toBe(false)
    expect(hasOpenClaimFlags({ status: 'no_corpus' })).toBe(false)
    expect(hasOpenClaimFlags(checked([supported(S1)]))).toBe(false)
    expect(hasOpenClaimFlags(checked([unsupported(S1)]))).toBe(true)
    expect(hasOpenClaimFlags(checked([{ ...fabricated(S1), resolution: { kind: 'accepted', at: 'x', by: 'u' } }]))).toBe(false)
  })
})

describe('the four HUMAN actions (§4.8)', () => {
  it('each open flag offers accept, edit, cite-existing and dismiss — and nothing that edits or creates', async () => {
    const c = await mount(flags(checked([unsupported(S1)])))
    const buttons = [...c.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).toContain('Accept as written')
    expect(buttons).toContain('Dismiss the flag')
    expect(c.textContent).toContain('Edit the text')
    expect(c.textContent).toContain('Cite existing evidence')
    expect(buttons.join(' ')).not.toMatch(/create|add evidence|rewrite|fix/i)
  })

  it('accept and dismiss submit the LITERAL resolution with the post id and the claim index', async () => {
    const c = await mount(flags(checked([supported(S2), unsupported(S1)])))
    const accept = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Accept as written')!
    expect(accept.getAttribute('name')).toBe('resolution')
    expect(accept.getAttribute('value')).toBe('accepted')
    const form = accept.closest('form')!
    expect((form.querySelector('input[name="postId"]') as HTMLInputElement).value).toBe(POST_ID)
    // the flagged claim is index 1 (index 0 is the cited one) — the ORIGINAL index, not its position among the flagged
    expect((form.querySelector('input[name="claimIndex"]') as HTMLInputElement).value).toBe('1')
    const dismiss = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Dismiss the flag')!
    expect(dismiss.getAttribute('value')).toBe('dismissed')
  })

  it('Edit is a plain LINK to the existing post-edit path (the system never edits the text)', async () => {
    const c = await mount(flags(checked([unsupported(S1)]), { editHref: '/en/campaigns/camp-1/posts' }))
    const link = [...c.querySelectorAll('a')].find((a) => a.textContent === 'Edit the text')!
    expect(link.getAttribute('href')).toBe('/en/campaigns/camp-1/posts')
  })

  it('Cite lists ONLY the existing evidence offered, as plain-text options, and submits resolution=cited', async () => {
    const c = await mount(flags(checked([fabricated(S2)])))
    const select = c.querySelector('select[name="evidenceMemoryId"]') as HTMLSelectElement
    const options = [...select.querySelectorAll('option')].filter((o) => o.value)
    expect(options.map((o) => o.value)).toEqual(EVIDENCE.map((e) => e.id))
    expect(options.map((o) => o.textContent)).toEqual(EVIDENCE.map((e) => e.snippet))
    const submit = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Link this evidence')!
    expect(submit.getAttribute('value')).toBe('cited')
    expect(select.required).toBe(true)
  })

  it('with no stored evidence the picker says so instead of offering to create some', async () => {
    const c = await mount(flags(checked([unsupported(S1)]), { evidenceOptions: [] }))
    expect(c.textContent).toContain('There is no stored evidence to choose from.')
    expect(c.querySelector('select')).toBeNull()
  })

  it('a resolved flag drops out of the action list and reads as what the human did', async () => {
    const c = await mount(
      flags(checked([{ ...unsupported(S1), resolution: { kind: 'accepted', at: 'x', by: 'u' } }, { ...fabricated(S2), resolution: { kind: 'cited', evidenceMemoryId: EVIDENCE[0].id, at: 'x', by: 'u' } }])),
    )
    expect(c.textContent).toContain('Accepted as written')
    expect(c.textContent).toContain('Linked to existing evidence')
    expect([...c.querySelectorAll('button')]).toHaveLength(0)
  })
})

describe('AGENCY-CLAIM-CITED-NOT-SUPPORTED — the vocabulary, rendered, in en/pt/es', () => {
  it('says "cited", carries the one-line explainer, and never says verified/supported (or the pt/es equivalents) in any state', async () => {
    const states: Array<PersistedClaimCheck | undefined> = [
      undefined,
      { status: 'no_claims' },
      { status: 'no_corpus' },
      checked([supported(S1), supported(S2)]),
      checked([unsupported(S1), fabricated(S2), supported('It was a good quarter.')]),
      checked([{ ...unsupported(S1), resolution: { kind: 'dismissed', at: 'x', by: 'u' } }, { outcome: 'unsupported', span: null }]),
    ]
    for (const locale of LOCALES) {
      for (const check of states) {
        const c = await mount(flags(check), locale)
        const text = c.textContent!
        expect(text, `${locale}: missing key`).not.toContain('⟦missing')
        expect(FORBIDDEN_VOCABULARY[locale].test(text), `${locale}: "${text.match(FORBIDDEN_VOCABULARY[locale])?.[0]}"`).toBe(false)
        await unmount()
      }
      const c = await mount(flags(checked([unsupported(S1), supported(S2)])), locale)
      expect(c.textContent, locale).toMatch(locale === 'en' ? /cited/ : /citad/)
      await unmount()
    }
  })

  it('the explainer states what "cited" does and does not mean, in one line', async () => {
    const c = await mount(flags(checked([unsupported(S1), supported(S2)])))
    const explainer = [...c.querySelectorAll('p')].find((p) => p.textContent?.startsWith('“Cited” means'))!
    expect(explainer.textContent).toMatch(/given to the AI/)
    expect(explainer.textContent).toMatch(/does not guarantee/)
  })

  it("the internal outcome word never renders, and a cited claim's evidence id is never shown", async () => {
    const c = await mount(flags(checked([supported(S1), unsupported(S2)])))
    expect(c.textContent).not.toMatch(/supported|fabricated|unsupported/i)
    expect(c.textContent).not.toContain('22222222-2222-4222-8222-222222222222')
  })
})

describe('accessibility and layout floor', () => {
  it('the flagged region is labelled and every control has a text name', async () => {
    const c = await mount(flags(checked([unsupported(S1)])))
    expect(c.querySelector('section')!.getAttribute('aria-label')).toBe('Claims in this post')
    for (const b of c.querySelectorAll('button')) expect((b.textContent ?? '').trim().length).toBeGreaterThan(0)
  })

  it('the flag list sits INSIDE the row card as hairlines, not as a second bordered box (no nested card)', async () => {
    const c = await mount(flags(checked([unsupported(S1)])))
    const list = c.querySelector('ul')!
    const tokens = list.className.split(/\s+/)
    expect(tokens.some((t) => t.startsWith('rounded'))).toBe(false)
    expect(tokens).not.toContain('border')
    expect(tokens).toContain('divide-y')
  })
})
