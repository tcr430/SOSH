// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

import { vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { AiOutputPreview } from './AiOutputPreview'
import type { PostAiOriginalRow } from '@/lib/db/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOriginal(payload: Record<string, unknown>): PostAiOriginalRow {
  return {
    id: 'origin-1',
    business_id: 'biz-1',
    post_id: 'post-1',
    campaign_id: 'camp-1',
    revision: 1,
    generation_kind: 'initial',
    format: 'single',
    payload,
    rendered_content: 'rendered',
    hashtags: [],
    schema_version: 1,
    created_at: '2026-08-22T00:00:00Z',
  }
}

function render(original: PostAiOriginalRow | undefined) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(AiOutputPreview, { original }))
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

// ── ADR 0022 §10 — carousel slides render in order with roles visible ───────

describe('AiOutputPreview — carousel slides (ADR 0022 §10)', () => {
  it('renders every slide, in order, with its role visible', () => {
    const original = makeOriginal({
      format: 'carousel',
      slides: [
        { text: 'Cover slide text', role: 'cover', imageBrief: null },
        { text: 'Body slide text', role: 'body', imageBrief: null },
        { text: 'CTA slide text', role: 'cta', imageBrief: null },
      ],
      imageBrief: null,
      scriptBrief: null,
    })
    const { container, cleanup } = render(original)

    const items = Array.from(container.querySelectorAll('li'))
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toContain('row.carousel.slideRole.cover')
    expect(items[0].textContent).toContain('Cover slide text')
    expect(items[1].textContent).toContain('row.carousel.slideRole.body')
    expect(items[1].textContent).toContain('Body slide text')
    expect(items[2].textContent).toContain('row.carousel.slideRole.cta')
    expect(items[2].textContent).toContain('CTA slide text')
    cleanup()
  })

  it('a misplaced cta (not last) is still legible in slide order, not silently reordered', () => {
    const original = makeOriginal({
      format: 'carousel',
      slides: [
        { text: 'Cover', role: 'cover', imageBrief: null },
        { text: 'Misplaced CTA', role: 'cta', imageBrief: null },
        { text: 'Body after CTA', role: 'body', imageBrief: null },
      ],
      imageBrief: null,
      scriptBrief: null,
    })
    const { container, cleanup } = render(original)

    const items = Array.from(container.querySelectorAll('li'))
    expect(items[1].textContent).toContain('row.carousel.slideRole.cta')
    expect(items[1].textContent).toContain('Misplaced CTA')
    expect(items[2].textContent).toContain('row.carousel.slideRole.body')
    cleanup()
  })

  it('renders nothing for a snapshot-less post (no post_ai_originals row)', () => {
    const { container, cleanup } = render(undefined)
    expect(container.textContent).toBe('')
    cleanup()
  })

  it('renders nothing when the payload fails structural validation (a malformed/legacy snapshot)', () => {
    const original = makeOriginal({ format: 'carousel', slides: [] })
    const { container, cleanup } = render(original)
    expect(container.textContent).toBe('')
    cleanup()
  })
})

// ── ADR 0022 §7.3/§10 — scriptBrief and imageBrief, never-published recommendations ──

describe('AiOutputPreview — scriptBrief renders with a never-published marker (ADR 0022 §7.3)', () => {
  it('renders scriptBrief text with the never-published marker present in the accessible name', () => {
    const original = makeOriginal({
      format: 'single',
      body: 'Post body',
      imageBrief: null,
      scriptBrief: 'Open on a close-up, then cut to the product shot.',
    })
    const { container, cleanup } = render(original)

    expect(container.textContent).toContain('Open on a close-up, then cut to the product shot.')
    expect(container.textContent).toContain('row.scriptBrief.neverPublishedNote')

    const note = container.querySelector('[role="note"][aria-label*="row.scriptBrief.neverPublishedNote"]')
    expect(note).not.toBeNull()
    cleanup()
  })

  it('renders nothing for scriptBrief when it is null (not omitted — a real "no recommendation" case)', () => {
    const original = makeOriginal({
      format: 'single',
      body: 'Post body',
      imageBrief: null,
      scriptBrief: null,
    })
    const { container, cleanup } = render(original)
    expect(container.textContent).not.toContain('row.scriptBrief')
    cleanup()
  })

  it('renders nothing for scriptBrief when the key is entirely absent (.nullish() — real model responses omit it)', () => {
    const original = makeOriginal({
      format: 'single',
      body: 'Post body',
      imageBrief: null,
    })
    const { container, cleanup } = render(original)
    expect(container.textContent).not.toContain('row.scriptBrief')
    cleanup()
  })
})

describe('AiOutputPreview — imageBrief renders with the same never-published treatment', () => {
  it('renders imageBrief text with the never-published marker present in the accessible name', () => {
    const original = makeOriginal({
      format: 'single',
      body: 'Post body',
      imageBrief: 'A wide shot of the dashboard in dark mode.',
      scriptBrief: null,
    })
    const { container, cleanup } = render(original)

    expect(container.textContent).toContain('A wide shot of the dashboard in dark mode.')
    const note = container.querySelector('[role="note"][aria-label*="row.imageBrief.neverPublishedNote"]')
    expect(note).not.toBeNull()
    cleanup()
  })

  it('renders nothing for imageBrief when it is null', () => {
    const original = makeOriginal({
      format: 'single',
      body: 'Post body',
      imageBrief: null,
      scriptBrief: null,
    })
    const { container, cleanup } = render(original)
    expect(container.textContent).not.toContain('row.imageBrief')
    cleanup()
  })
})

// ── A carousel post can carry its own imageBrief/scriptBrief too ──────────

describe('AiOutputPreview — carousel post can also carry branch-level imageBrief/scriptBrief', () => {
  it('renders slides AND the branch-level scriptBrief together', () => {
    const original = makeOriginal({
      format: 'carousel',
      slides: [
        { text: 'Cover', role: 'cover', imageBrief: null },
        { text: 'Body', role: 'body', imageBrief: null },
        { text: 'CTA', role: 'cta', imageBrief: null },
      ],
      imageBrief: null,
      scriptBrief: 'Film this as one continuous pan across the three slides.',
    })
    const { container, cleanup } = render(original)

    expect(container.querySelectorAll('li')).toHaveLength(3)
    expect(container.textContent).toContain('Film this as one continuous pan across the three slides.')
    cleanup()
  })
})
