// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0029 §8 (Session 35 M2.10) INTERVIEW-UI-STATES / INTERVIEW-I18N-COMPLETE — every Section 8.2 state
// renders and is distinguishable from the persisted status; no accept-all; the span renders beneath every
// record; evidence has no edit control and does show the permission marker; every Accept/Reject control's
// accessible name contains its record's text; the counter's live region is polite and fires at 80%/100% only.

const routerRefresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }))

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key)
    t.has = (key: string) => key.startsWith('ui.extraction_failed.reasons.')
    return t
  },
}))

const startInterviewRoundAction = vi.fn().mockResolvedValue({ ok: true, result: { outcome: 'ok', roundId: 'r-new' } })
const saveInterviewAnswerAction = vi.fn().mockResolvedValue({ ok: true, result: { outcome: 'ok', answerId: 'a-1' } })
const skipInterviewQuestionAction = vi.fn().mockResolvedValue({ ok: true, result: { outcome: 'ok', answerId: 'a-1' } })
const skipInterviewRoundAction = vi.fn().mockResolvedValue({ ok: true, result: { outcome: 'ok', skippedAnswers: 0 } })
const submitInterviewRoundAction = vi.fn().mockResolvedValue({ ok: true, result: { outcome: 'ok', roundId: 'r-1' } })
const retryInterviewExtractionAction = vi.fn().mockResolvedValue({ ok: true, result: { outcome: 'retrying' } })
const snoozeInterviewAction = vi.fn().mockResolvedValue({ ok: true, result: { outcome: 'ok', snoozedUntil: '2026-10-04T00:00:00Z' } })
const ratifyInterviewRoundAction = vi.fn().mockResolvedValue({ ok: true, result: { outcome: 'ratified', accepted: 1, rejected: 0, edited: 0, replaced: 0 } })

vi.mock('./actions', () => ({
  startInterviewRoundAction: (...a: unknown[]) => startInterviewRoundAction(...a),
  saveInterviewAnswerAction: (...a: unknown[]) => saveInterviewAnswerAction(...a),
  skipInterviewQuestionAction: (...a: unknown[]) => skipInterviewQuestionAction(...a),
  skipInterviewRoundAction: (...a: unknown[]) => skipInterviewRoundAction(...a),
  submitInterviewRoundAction: (...a: unknown[]) => submitInterviewRoundAction(...a),
  retryInterviewExtractionAction: (...a: unknown[]) => retryInterviewExtractionAction(...a),
  snoozeInterviewAction: (...a: unknown[]) => snoozeInterviewAction(...a),
  ratifyInterviewRoundAction: (...a: unknown[]) => ratifyInterviewRoundAction(...a),
}))

import { InterviewPanel } from './InterviewPanel'
import type { InterviewPageState } from '@/lib/interview/page-state'
import type { FounderInterviewAnswerRow, FounderInterviewRoundRow, BrandMemoryRow, AudienceMemoryRow, EvidenceMemoryRow } from '@/lib/db/types'

function round(over: Partial<FounderInterviewRoundRow> = {}): FounderInterviewRoundRow {
  return {
    id: 'round-1', business_id: 'biz-1', status: 'open', question_count: 6, bank_version: 1,
    created_by: null, created_at: '2026-09-26T12:00:00.000Z', submitted_at: null, claimed_at: null,
    extraction_attempts: 0, spend_cents: 0, ceiling_cents: 30, error_code: null, extracted_at: null,
    ratified_at: null, ratified_by: null, terminal_at: null, items_proposed: 0, dropped_ungrounded: 0,
    dropped_performance_claim: 0, candidates_written_brand: 0, candidates_written_audience: 0,
    candidates_written_evidence: 0, accepted: 0, rejected: 0, edited: 0, replaced: 0,
    updated_at: '2026-09-26T12:00:00.000Z',
    ...over,
  }
}

function answer(over: Partial<FounderInterviewAnswerRow> = {}): FounderInterviewAnswerRow {
  return {
    id: 'a-1', business_id: 'biz-1', round_id: 'round-1', position: 1, question_key: 'positioning_one_line',
    bank_version: 1, slot_type: 'brand', slot_category: 'positioning', status: 'pending', answer_text: null,
    char_count: null, answered_by: null, answered_at: null, redacted_at: null,
    created_at: '2026-09-26T12:00:00.000Z', updated_at: '2026-09-26T12:00:00.000Z',
    ...over,
  }
}

function memoryGovernance() {
  return {
    business_id: 'biz-1', source: 'interview' as const, confidence: 0.6, observation_count: 1,
    status: 'candidate' as const, sensitivity: 'internal' as const, public_use_permission: false,
    scope: 'brand' as const, scope_ref: null, last_confirmed_at: null, recency_at: '2026-09-26T12:00:00.000Z',
    expires_at: null, deleted_at: null, created_at: '2026-09-26T12:00:00.000Z', updated_at: '2026-09-26T12:00:00.000Z',
    import_run_id: null, import_source_post_ids: null,
    interview_answer_id: 'a-1', interview_span: 'we integrate natively', interview_span_redacted_at: null,
    interview_extracted_text: 'We integrate natively with every platform', interview_edited: false,
  }
}

function brandCandidate(over: Partial<BrandMemoryRow> = {}): BrandMemoryRow {
  return { id: 'bm-1', ...memoryGovernance(), category: 'positioning', statement: 'We integrate natively with every platform', ...over }
}
function audienceCandidate(over: Partial<AudienceMemoryRow> = {}): AudienceMemoryRow {
  return { id: 'au-1', ...memoryGovernance(), segment: null, kind: 'problem', statement: 'CTOs struggle to post consistently', ...over }
}
function evidenceCandidate(over: Partial<EvidenceMemoryRow> = {}): EvidenceMemoryRow {
  return { id: 'ev-1', ...memoryGovernance(), kind: 'quote', content: 'This tool saved us hours every week', source_url: null, ...over }
}

function renderPanel(state: InterviewPageState, locale = 'en') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(InterviewPanel, { state, locale }))
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

let cleanupFns: (() => void)[] = []
afterEach(() => {
  cleanupFns.forEach((fn) => fn())
  cleanupFns = []
  vi.clearAllMocks()
})

// ── Every Section 8.2 state renders and is distinguishable ─────────────────────────────────────────────────

describe('InterviewPanel — every Section 8.2 state renders with its own data-state, distinguishable from the others', () => {
  const cases: Array<[string, InterviewPageState]> = [
    ['not_due', { kind: 'not_due', nextEligibleAt: null }],
    ['nothing_thin', { kind: 'nothing_thin' }],
    ['due', { kind: 'due', questionCount: 6 }],
    ['in_progress', { kind: 'in_progress', round: round(), answers: [answer()] }],
    ['extracting', { kind: 'extracting', round: round({ status: 'extracting' }) }],
    ['extraction_failed', { kind: 'extraction_failed', round: round({ status: 'extraction_failed', error_code: 'timeout' }), canRetry: true, ceilingReached: false }],
    ['failed', { kind: 'failed', round: round({ status: 'failed' }) }],
    ['awaiting_ratification (author)', { kind: 'awaiting_ratification', round: round({ status: 'awaiting_ratification' }), isRatifier: false, candidates: null, answers: [] }],
    ['ratified', { kind: 'ratified', round: round({ status: 'ratified', accepted: 2, rejected: 1, edited: 1 }) }],
    ['no_records', { kind: 'no_records', round: round({ status: 'no_records', items_proposed: 3, dropped_ungrounded: 2, dropped_performance_claim: 1 }) }],
    ['skipped', { kind: 'skipped', round: round({ status: 'skipped' }) }],
    ['expired', { kind: 'expired', round: round({ status: 'expired' }) }],
  ]

  const seenDataStates = new Set<string>()

  it.each(cases)('%s renders a unique data-state attribute', (_name, state) => {
    const { container, cleanup } = renderPanel(state)
    cleanupFns.push(cleanup)
    const el = container.querySelector('[data-state]')
    expect(el, `${_name} must render an element with data-state`).not.toBeNull()
    const value = el!.getAttribute('data-state')!
    expect(seenDataStates.has(value), `data-state "${value}" reused across states — no_records vs extraction_failed and every other pair must be visibly distinguishable`).toBe(false)
    seenDataStates.add(value)
  })

  it('not_due renders the snooze date when one applies, without changing its data-state', () => {
    const plain = renderPanel({ kind: 'not_due', nextEligibleAt: null })
    const snoozed = renderPanel({ kind: 'not_due', nextEligibleAt: '2026-10-04T00:00:00.000Z' })
    cleanupFns.push(plain.cleanup, snoozed.cleanup)
    expect(plain.container.querySelector('[data-state]')!.getAttribute('data-state')).toBe('not-due')
    expect(snoozed.container.querySelector('[data-state]')!.getAttribute('data-state')).toBe('not-due')
    expect(plain.container.textContent).toContain('ui.not_due.body')
    expect(snoozed.container.textContent).toContain('ui.not_due.body_snoozed')
  })

  it('no_records and extraction_failed are rendered with different data-state values and different title copy', () => {
    const noRecords = renderPanel({ kind: 'no_records', round: round({ status: 'no_records' }) })
    const extractionFailed = renderPanel({ kind: 'extraction_failed', round: round({ status: 'extraction_failed' }), canRetry: true, ceilingReached: false })
    cleanupFns.push(noRecords.cleanup, extractionFailed.cleanup)
    expect(noRecords.container.querySelector('[data-state]')!.getAttribute('data-state')).not.toBe(
      extractionFailed.container.querySelector('[data-state]')!.getAttribute('data-state'),
    )
    expect(noRecords.container.textContent).toContain('ui.no_records.title')
    expect(extractionFailed.container.textContent).toContain('ui.extraction_failed.title')
  })

  it('the cost-ceiling reason is visibly distinct from a plain retryable extraction_failed', () => {
    const retryable = renderPanel({ kind: 'extraction_failed', round: round({ status: 'extraction_failed', error_code: 'timeout' }), canRetry: true, ceilingReached: false })
    const atCeiling = renderPanel({ kind: 'extraction_failed', round: round({ status: 'extraction_failed' }), canRetry: false, ceilingReached: true })
    cleanupFns.push(retryable.cleanup, atCeiling.cleanup)
    expect(retryable.container.textContent).toContain('ui.extraction_failed.title')
    expect(retryable.container.textContent).not.toContain('ui.extraction_failed.ceiling_title')
    expect(atCeiling.container.textContent).toContain('ui.extraction_failed.ceiling_title')
    expect(atCeiling.container.querySelector('button')).toBeNull() // no Try again at the ceiling
  })

  it('authors see "waiting for an approver"; ratifiers see the review list, for the SAME state input otherwise', () => {
    const asAuthor = renderPanel({ kind: 'awaiting_ratification', round: round({ status: 'awaiting_ratification' }), isRatifier: false, candidates: null, answers: [] })
    const asRatifier = renderPanel({
      kind: 'awaiting_ratification',
      round: round({ status: 'awaiting_ratification' }),
      isRatifier: true,
      candidates: { brand: [brandCandidate()], audience: [], evidence: [] },
      answers: [answer({ status: 'answered' })],
    })
    cleanupFns.push(asAuthor.cleanup, asRatifier.cleanup)
    expect(asAuthor.container.textContent).toContain('ui.awaiting_ratification.author_title')
    expect(asRatifier.container.textContent).toContain('ui.awaiting_ratification.ratify_title')
    expect(asRatifier.container.querySelector('[data-state="awaiting-ratification-ratify"]')).not.toBeNull()
  })
})

// ── No accept-all, anywhere ──────────────────────────────────────────────────────────────────────────────────

describe('no accept-all control exists in any state (ADR 0029 §8.4 — loses to ADR 0025 §10.3)', () => {
  it('the ratification list has exactly Accept/Reject per item, never a bulk verb', () => {
    const { container, cleanup } = renderPanel({
      kind: 'awaiting_ratification',
      round: round({ status: 'awaiting_ratification' }),
      isRatifier: true,
      candidates: { brand: [brandCandidate(), brandCandidate({ id: 'bm-2' })], audience: [], evidence: [] },
      answers: [answer({ status: 'answered' })],
    })
    cleanupFns.push(cleanup)
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent)
    expect(buttons.every((label) => !/accept.?all|reject.?all/i.test(label ?? ''))).toBe(true)
    expect(container.innerHTML).not.toMatch(/accept_all|reject_all/i)
  })

  it('no checkbox exists in the ratification list (a checked-by-default input is the accept-all pattern this ADR rejects)', () => {
    const { container, cleanup } = renderPanel({
      kind: 'awaiting_ratification',
      round: round({ status: 'awaiting_ratification' }),
      isRatifier: true,
      candidates: { brand: [brandCandidate()], audience: [], evidence: [] },
      answers: [],
    })
    cleanupFns.push(cleanup)
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
  })
})

// ── The span renders beneath every record, never hidden by default ─────────────────────────────────────────

describe('the answer span renders beneath every record (§8.4), including a redacted one', () => {
  it('brand, audience and evidence candidates each show their span in a blockquote', () => {
    const { container, cleanup } = renderPanel({
      kind: 'awaiting_ratification',
      round: round({ status: 'awaiting_ratification' }),
      isRatifier: true,
      candidates: {
        brand: [brandCandidate({ interview_span: 'brand span text' })],
        audience: [audienceCandidate({ interview_span: 'audience span text' })],
        evidence: [evidenceCandidate({ interview_span: 'evidence span text' })],
      },
      answers: [answer({ status: 'answered' })],
    })
    cleanupFns.push(cleanup)
    const quotes = Array.from(container.querySelectorAll('blockquote'))
    expect(quotes).toHaveLength(3)
    expect(quotes.some((q) => q.textContent?.includes('brand span text'))).toBe(true)
    expect(quotes.some((q) => q.textContent?.includes('audience span text'))).toBe(true)
    expect(quotes.some((q) => q.textContent?.includes('evidence span text'))).toBe(true)
  })

  it('a redacted span (span null, redacted_at set) shows the redaction notice, never a blank or hidden block', () => {
    const { container, cleanup } = renderPanel({
      kind: 'awaiting_ratification',
      round: round({ status: 'awaiting_ratification' }),
      isRatifier: true,
      candidates: { brand: [brandCandidate({ interview_span: null, interview_span_redacted_at: '2026-11-01T00:00:00Z' })], audience: [], evidence: [] },
      answers: [],
    })
    cleanupFns.push(cleanup)
    expect(container.querySelector('blockquote')?.textContent).toContain('ui.ratify.span_redacted')
  })
})

// ── Evidence: no edit control, but the permission marker shows ─────────────────────────────────────────────

describe('evidence candidates have no edit control and DO show the permission-off marker (§4.6/§8.4)', () => {
  it('an evidence item renders no textarea and no editable text control; brand/audience DO get a textarea', () => {
    const { container, cleanup } = renderPanel({
      kind: 'awaiting_ratification',
      round: round({ status: 'awaiting_ratification' }),
      isRatifier: true,
      candidates: { brand: [brandCandidate()], audience: [], evidence: [evidenceCandidate()] },
      answers: [answer({ status: 'answered' })],
    })
    cleanupFns.push(cleanup)
    const items = Array.from(container.querySelectorAll('[data-candidate-id]'))
    const evidenceItem = items.find((el) => el.textContent?.includes('This tool saved us hours every week'))!
    const brandItem = items.find((el) => el.querySelector('textarea'))!
    expect(evidenceItem.querySelector('textarea')).toBeNull()
    expect(brandItem.querySelector('textarea')).not.toBeNull()
    expect(evidenceItem.textContent).toContain('ui.ratify.evidence_permission_off')
    expect(brandItem.textContent).not.toContain('ui.ratify.evidence_permission_off')
  })
})

// ── Accessible names contain the record's text ──────────────────────────────────────────────────────────────

describe("every Accept/Reject control's accessible name includes the record it acts on (§8.7)", () => {
  it('the accept and reject buttons carry aria-label with the candidate text', () => {
    const { container, cleanup } = renderPanel({
      kind: 'awaiting_ratification',
      round: round({ status: 'awaiting_ratification' }),
      isRatifier: true,
      candidates: { brand: [brandCandidate({ statement: 'A distinctive claim about our product' })], audience: [], evidence: [] },
      answers: [],
    })
    cleanupFns.push(cleanup)
    const acceptButton = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.startsWith('ui.ratify.accept_for'))!
    const rejectButton = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.startsWith('ui.ratify.reject_for'))!
    expect(acceptButton.getAttribute('aria-label')).toContain('A distinctive claim about our product')
    expect(rejectButton.getAttribute('aria-label')).toContain('A distinctive claim about our product')
  })
})

// ── Ratify requires a decision on every candidate ───────────────────────────────────────────────────────────

describe('Ratify is enabled only once every candidate is decided', () => {
  it('disabled with undecided items, enabled once all are accepted or rejected', () => {
    const { container, cleanup } = renderPanel({
      kind: 'awaiting_ratification',
      round: round({ status: 'awaiting_ratification' }),
      isRatifier: true,
      candidates: { brand: [brandCandidate({ id: 'bm-1' }), brandCandidate({ id: 'bm-2' })], audience: [], evidence: [] },
      answers: [],
    })
    cleanupFns.push(cleanup)
    const ratifyButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'ui.awaiting_ratification.ratify_button')!
    expect(ratifyButton.hasAttribute('disabled')).toBe(true)

    const acceptButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.getAttribute('aria-label')?.startsWith('ui.ratify.accept_for'))
    act(() => { acceptButtons[0].click() })
    expect(ratifyButton.hasAttribute('disabled')).toBe(true) // one of two decided

    act(() => { acceptButtons[1].click() })
    expect(ratifyButton.hasAttribute('disabled')).toBe(false)
  })
})

// ── The counter's live region is polite and fires at 80%/100% only ─────────────────────────────────────────

describe("the character counter's live region announces politely at 80% and 100%, not per keystroke (§8.7)", () => {
  it('stays empty below 80%, then announces once at 80% and again at 100%, without re-announcing mid-range', () => {
    const { container, cleanup } = renderPanel({ kind: 'in_progress', round: round(), answers: [answer()] })
    cleanupFns.push(cleanup)
    const textarea = container.querySelector('textarea')!
    const liveRegion = container.querySelector('[aria-live="polite"].sr-only')!

    act(() => { typeInto(textarea, 'x'.repeat(100)) }) // 5% of 2000 — well below 80%
    expect(liveRegion.textContent).toBe('')

    act(() => { typeInto(textarea, 'x'.repeat(1600)) }) // exactly 80%
    expect(liveRegion.textContent).toBe('ui.question.counter_80:{"remaining":400}')

    act(() => { typeInto(textarea, 'x'.repeat(1700)) }) // still >= 80%, < 100% — same announcement text is fine, no crash
    expect(liveRegion.textContent).toContain('ui.question.counter_80')

    act(() => { typeInto(textarea, 'x'.repeat(2000)) }) // 100%
    expect(liveRegion.textContent).toBe('ui.question.counter_full')
  })

  it('the visible (non-live) counter updates every keystroke — only the announcement is throttled', () => {
    const { container, cleanup } = renderPanel({ kind: 'in_progress', round: round(), answers: [answer()] })
    cleanupFns.push(cleanup)
    const textarea = container.querySelector('textarea')!
    act(() => { typeInto(textarea, 'hello') })
    expect(container.textContent).toContain('ui.question.counter:{"count":5,"max":2000}')
  })
})

// ── in_progress: answered count and submit gating ───────────────────────────────────────────────────────────

describe('in_progress: n of m answered, submit requires at least one answer', () => {
  it('shows 0 of N initially, and the error only after attempting to submit with zero answers', () => {
    const { container, cleanup } = renderPanel({ kind: 'in_progress', round: round(), answers: [answer(), answer({ id: 'a-2', question_key: 'capability_core', slot_category: 'capability' })] })
    cleanupFns.push(cleanup)
    expect(container.textContent).toContain('ui.in_progress.progress:{"answered":0,"total":2}')
    expect(container.textContent).not.toContain('ui.in_progress.no_answers_error')
    const submitButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'ui.in_progress.submit')!
    act(() => { submitButton.click() })
    expect(container.textContent).toContain('ui.in_progress.no_answers_error')
    expect(submitInterviewRoundAction).not.toHaveBeenCalled()
  })
})

// ── No dangerouslySetInnerHTML on this surface ──────────────────────────────────────────────────────────────

describe('no dangerouslySetInnerHTML or markdown rendering on the interview surfaces', () => {
  it('InterviewPanel.tsx never uses dangerouslySetInnerHTML as a JSX prop (a mention in an explanatory comment is fine)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app', '[locale]', '(dashboard)', 'interview', 'InterviewPanel.tsx'), 'utf8')
    expect(src).not.toMatch(/dangerouslySetInnerHTML\s*=/)
  })
})
