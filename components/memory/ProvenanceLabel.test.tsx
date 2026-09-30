// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// ADR 0030 §9.2 (Session 36 L2.10) — SUBSTRATE-UX-DISCLOSED, the label half. The real en/pt/es strings are used so the RENDERED text is asserted.
const holder = vi.hoisted(() => ({ locale: 'en' as 'en' | 'pt' | 'es' }))
vi.mock('next-intl', async () => {
  const { makeTranslator } = await import('@/lib/i18n/__test-utils__/translator')
  return { useTranslations: (namespace: string) => makeTranslator(holder.locale, namespace) }
})

import { ProvenanceLabel, useProvenanceLabel, PROVENANCE_SOURCES, isProvenanceSource } from './ProvenanceLabel'

let root: Root | null = null
let host: HTMLElement | null = null
function render(node: React.ReactElement): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  holder.locale = 'en'
})

const EN: Record<string, string> = {
  manual: 'Added by you',
  distilled: 'Learned from your edits',
  import: 'From your posts',
  interview: 'From your interview',
  outcome: 'From your results',
  dismissal: 'From dismissed ideas',
}

describe('ProvenanceLabel (ADR 0030 §9.2)', () => {
  it('there are exactly the six sources of §9.2', () => {
    expect([...PROVENANCE_SOURCES].sort()).toEqual(['dismissal', 'distilled', 'import', 'interview', 'manual', 'outcome'])
  })

  it.each(Object.entries(EN))('source %s renders exactly the EN string %s, from the row\'s own source', (source, text) => {
    const c = render(<ProvenanceLabel source={source as never} />)
    const el = c.querySelector('[data-provenance]')!
    expect(el.textContent).toBe(text)
    expect(el.getAttribute('data-provenance')).toBe(source)
  })

  it('is PLAIN TEXT in the muted foreground token: no background, border, ring or colour-only badge classes', () => {
    const c = render(<ProvenanceLabel source="import" />)
    const el = c.querySelector('[data-provenance]')!
    const classes = el.getAttribute('class')!.split(/\s+/)
    expect(classes).toContain('text-muted-foreground')
    expect(classes.filter((k) => /^(bg-|border|ring|rounded|px-|py-|shadow)/.test(k))).toEqual([])
    expect(el.tagName).toBe('SPAN')
  })

  it('renders NOTHING for a value that is not one of the six (it never guesses a label)', () => {
    const c = render(<ProvenanceLabel source={'brand_memory' as never} />)
    expect(c.querySelector('[data-provenance]')).toBeNull()
    expect(c.textContent).toBe('')
  })

  it('isProvenanceSource narrows exactly the six and nothing else, in particular not a table name', () => {
    for (const s of PROVENANCE_SOURCES) expect(isProvenanceSource(s)).toBe(true)
    for (const s of ['brand_memory', 'audience_memory', 'evidence_memory', 'performance_memory', '', 'Import']) expect(isProvenanceSource(s)).toBe(false)
  })

  it('useProvenanceLabel returns the same string for use where an element cannot go (a native <option>)', () => {
    function Probe() {
      const label = useProvenanceLabel()
      return <p>{label('interview')}</p>
    }
    expect(render(<Probe />).textContent).toBe('From your interview')
  })

  it('every one of the six renders a real string in en, pt AND es (never the missing-key marker)', () => {
    for (const locale of ['en', 'pt', 'es'] as const) {
      holder.locale = locale
      for (const source of PROVENANCE_SOURCES) {
        const c = render(<ProvenanceLabel source={source} />)
        const text = c.querySelector('[data-provenance]')!.textContent!
        expect(text, `${locale}: ${source}`).not.toContain('⟦missing')
        expect(text.trim().length, `${locale}: ${source}`).toBeGreaterThan(3)
        act(() => root!.unmount())
        host!.remove()
        root = null
      }
    }
  })
})
