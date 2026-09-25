// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const holder = vi.hoisted(() => ({ locale: 'en' as 'en' | 'pt' | 'es' }))

vi.mock('next-intl', async () => {
  const { makeTranslator } = await import('@/lib/i18n/__test-utils__/translator')
  return { useTranslations: (namespace: string) => makeTranslator(holder.locale, namespace) }
})

import { RedundancyFlag } from './RedundancyFlag'
import { LOCALES, FORBIDDEN_VOCABULARY } from '@/lib/i18n/__test-utils__/translator'
import type { PersistedRedundancy } from '@/lib/db/types'

// ADR 0027 §5.8(b) (Session 34-D D9, MAJOR-5). Tier 2, rendered against the REAL en/pt/es strings. The flag says WHICH
// other post this one repeats (its position in the campaign's plan) and HOW MUCH of the wording overlaps, and that it
// is a structural comparison, not a judgment. It is informational: no control, no text from either post.
//
// SHARED-FUNCTION CALLERS: RedundancyFlag has ONE caller, ApprovalsInbox.tsx's DraftRow (integration:
// ApprovalsInbox.test.tsx, describe "redundancy flags in DraftRow").

const FLAG: PersistedRedundancy = { contentFingerprint: 'f', overlaps: [{ order: 2, postId: 'p-3', overlap: 0.72 }] }

let root: Root | undefined
let container: HTMLDivElement | undefined
function render(redundancy: PersistedRedundancy | undefined, locale: 'en' | 'pt' | 'es' = 'en') {
  holder.locale = locale
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(React.createElement(RedundancyFlag, { redundancy })))
  return container
}
function unmount() {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
}
afterEach(unmount)

describe('RedundancyFlag', () => {
  it('renders nothing for an unflagged post, and nothing for an empty flag', () => {
    expect(render(undefined).innerHTML).toBe('')
    unmount()
    expect(render({ contentFingerprint: 'f', overlaps: [] }).innerHTML).toBe('')
  })

  it('names WHICH other post it repeats (position = plan order + 1) and how much overlaps', () => {
    const text = render(FLAG).textContent ?? ''
    expect(text).toContain('Repeats the post at position 3')
    expect(text).toContain('72% of the wording overlaps')
  })

  it('says it is a structural comparison, not a judgment — and that nothing was changed and Approve is still available', () => {
    const text = render(FLAG).textContent ?? ''
    expect(text).toContain('structural word-overlap comparison, not a judgment of quality')
    expect(text).toContain('Nothing was changed')
    expect(text).toContain('you can still approve')
  })

  it('lists one line per repeated post when a post repeats several', () => {
    const flag: PersistedRedundancy = {
      contentFingerprint: 'f',
      overlaps: [
        { order: 0, postId: 'a', overlap: 0.61 },
        { order: 4, postId: 'b', overlap: 1 },
      ],
    }
    const c = render(flag)
    const items = [...c.querySelectorAll('li')].map((li) => li.textContent)
    expect(items).toHaveLength(2)
    expect(items[0]).toContain('position 1')
    expect(items[0]).toContain('61%')
    expect(items[1]).toContain('position 5')
    expect(items[1]).toContain('100%')
  })

  it('is INFORMATIONAL: no button, no link, no form control, and no text from either post', () => {
    const c = render(FLAG)
    expect(c.querySelector('button, a, input, select, textarea, form')).toBeNull()
    expect(c.querySelector('section')?.getAttribute('aria-label')).toBe('Repetition in this campaign')
  })

  it('resolves every string in en, pt AND es (no missing-key marker), and never uses the forbidden vocabulary', () => {
    for (const locale of LOCALES) {
      const text = render(FLAG, locale).textContent ?? ''
      expect(text, locale).not.toContain('⟦missing')
      expect(text, locale).toContain('72')
      expect(FORBIDDEN_VOCABULARY[locale].test(text), `${locale}: "${text.match(FORBIDDEN_VOCABULARY[locale])?.[0]}"`).toBe(false)
      unmount()
    }
  })

  it('pt and es are actually translated, not copies of en', () => {
    const en = render(FLAG, 'en').textContent
    unmount()
    const pt = render(FLAG, 'pt').textContent
    unmount()
    const es = render(FLAG, 'es').textContent
    expect(pt).not.toBe(en)
    expect(es).not.toBe(en)
    expect(pt).toContain('posição 3')
    expect(es).toContain('posición 3')
  })
})
