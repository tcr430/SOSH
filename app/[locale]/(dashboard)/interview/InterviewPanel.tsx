'use client'

// ADR 0029 §8 (Session 35 M2.10) — the /interview page's whole client-side surface. Server Component page.tsx
// computes ONE InterviewPageState (lib/interview/page-state.ts, via loadInterviewPageState) and hands it here;
// this file only renders it and calls the M2.9 Server Actions. Two named Client Components per the build guide
// ("name them"): InterviewAnswerPanel (answering) and InterviewRatifyPanel (ratifying) — InterviewPanel is the
// top-level switch that picks one of them, or renders an inline confirmation, per state.
//
// NEITHER taste-skill NOR impeccable (both run against this file after it exists) may add an accept-all, hide
// the answer span by default, make evidence editable, add a time limit, move answer state into browser
// storage, or render markdown/dangerouslySetInnerHTML — the server is the source of truth throughout.
//
// KNOWN GAP, recorded rather than faked (ADR finding, not an M2.10 defect): the hedge flag (§4.4) and the
// "may conflict with" marker (§4.5) are NOT rendered here, because neither is persisted anywhere upstream —
// M2.8's orchestrator computes both but only ever returns them as ROUND-LEVEL aggregates
// (InterviewExtractionResult.hedgeFlagged: number, .conflicts: InterviewConflict[]), and no migration through
// M2.9 added a column to store either per candidate. Replace (§4.5) is omitted for the same reason: there is
// no conflict target to replace. The evidence permission-off marker (§4.6) needs no such column — it is fixed
// for every evidence-type interview candidate — and IS rendered below.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { enUS, pt, es, type Locale } from 'date-fns/locale'
import { AlertTriangle, CalendarX, CheckCircle2, Clock, FileX, Loader2, SkipForward, Users, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  ratifyInterviewRoundAction,
  retryInterviewExtractionAction,
  saveInterviewAnswerAction,
  skipInterviewQuestionAction,
  skipInterviewRoundAction,
  snoozeInterviewAction,
  startInterviewRoundAction,
  submitInterviewRoundAction,
} from './actions'
import type { InterviewPageState } from '@/lib/interview/page-state'
import { questionMessagePath, whyMessagePath } from '@/lib/interview/bank'
import { INTERVIEW_ANSWER_MAX_CHARS, INTERVIEW_RECORD_TEXT_MAX_CHARS } from '@/lib/interview/constants'
import type { FounderInterviewAnswerRow, FounderInterviewSlotType } from '@/lib/db/types'
import type { InterviewCandidatesByType } from '@/lib/memory/interview'

const DATE_FNS_LOCALES: Record<string, Locale> = { en: enUS, pt, es }

const CATEGORY_OPTIONS: Record<FounderInterviewSlotType, readonly string[]> = {
  brand: ['positioning', 'capability', 'pricing', 'competitor', 'other'],
  audience: ['problem', 'objection', 'question', 'trigger', 'other'],
  evidence: ['quote', 'case_study', 'usage_data', 'other'],
}

// impeccable audit (Session 35 M2.10): no_records and extraction_failed rendered as IDENTICAL layouts save for
// text — ADR §10.5's own named "likeliest silent failure." A distinct icon per state gives a founder skimming
// (not reading every word) an at-a-glance signal, using the SAME icon family DashboardShell.tsx already uses
// (lucide-react) — a state marker, not decoration.
function StateHeading({ icon: Icon, headingRef, children }: { icon: React.ComponentType<{ className?: string }>; headingRef: React.Ref<HTMLHeadingElement>; children: React.ReactNode }) {
  return (
    <h1 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-xl font-semibold outline-none">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {children}
    </h1>
  )
}

export function InterviewPanel({ state, locale }: { state: InterviewPageState; locale: string }) {
  const t = useTranslations('interview')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const headingRef = useRef<HTMLHeadingElement>(null)

  function focusHeading() {
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  function handleStart() {
    startTransition(async () => {
      const result = await startInterviewRoundAction()
      if (result.ok) {
        router.refresh()
        focusHeading()
      }
    })
  }

  function handleNotNow() {
    startTransition(async () => {
      const result = await snoozeInterviewAction()
      if (result.ok) router.refresh()
    })
  }

  function handleRetry() {
    if (state.kind !== 'extraction_failed') return
    startTransition(async () => {
      const result = await retryInterviewExtractionAction({ roundId: state.round.id })
      if (result.ok) router.refresh()
    })
  }

  const dateFnsLocale = DATE_FNS_LOCALES[locale] ?? enUS

  switch (state.kind) {
    case 'not_due':
      return (
        <div data-state="not-due" className="space-y-2 max-w-lg">
          <StateHeading icon={Clock} headingRef={headingRef}>{t('ui.not_due.title')}</StateHeading>
          <p className="text-sm text-muted-foreground">
            {state.nextEligibleAt ? t('ui.not_due.body_snoozed', { date: format(new Date(state.nextEligibleAt), 'PP', { locale: dateFnsLocale }) }) : t('ui.not_due.body')}
          </p>
        </div>
      )

    case 'nothing_thin':
      return (
        <div data-state="nothing-thin" className="space-y-2 max-w-lg">
          <StateHeading icon={CheckCircle2} headingRef={headingRef}>{t('ui.nothing_thin.title')}</StateHeading>
          <p className="text-sm text-muted-foreground">{t('ui.nothing_thin.body')}</p>
        </div>
      )

    case 'due':
      return (
        <div data-state="due" className="space-y-4 max-w-lg">
          <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
            {t('ui.due.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('ui.due.body', { count: state.questionCount })}</p>
          <div className="flex items-center gap-4">
            <Button onClick={handleStart} disabled={isPending}>
              {t('ui.due.start')}
            </Button>
            <button
              type="button"
              onClick={handleNotNow}
              disabled={isPending}
              className="flex min-h-11 items-center rounded-sm px-1 text-sm text-muted-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {t('ui.due.not_now')}
            </button>
          </div>
        </div>
      )

    case 'in_progress':
      return <InterviewAnswerPanel round={state.round} initialAnswers={state.answers} onRoundChanged={() => router.refresh()} />

    case 'extracting':
      return (
        <div data-state="extracting" className="space-y-2 max-w-lg" aria-live="polite">
          <h1 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-xl font-semibold outline-none">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
            {t('ui.extracting.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('ui.extracting.body')}</p>
        </div>
      )

    case 'extraction_failed': {
      const reasonKey = state.round.error_code ?? 'unknown'
      return (
        <div data-state="extraction-failed" className="space-y-3 max-w-lg">
          <StateHeading icon={AlertTriangle} headingRef={headingRef}>
            {state.ceilingReached ? t('ui.extraction_failed.ceiling_title') : t('ui.extraction_failed.title')}
          </StateHeading>
          {state.ceilingReached ? (
            <p className="text-sm text-muted-foreground">{t('ui.extraction_failed.ceiling_body')}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('ui.extraction_failed.reason', { reason: t.has(`ui.extraction_failed.reasons.${reasonKey}`) ? t(`ui.extraction_failed.reasons.${reasonKey}` as never) : t('ui.extraction_failed.reasons.unknown') })}
            </p>
          )}
          {state.canRetry && (
            <Button onClick={handleRetry} disabled={isPending}>
              {t('ui.extraction_failed.try_again')}
            </Button>
          )}
        </div>
      )
    }

    case 'failed':
      return (
        <div data-state="failed" className="space-y-2 max-w-lg">
          <StateHeading icon={XCircle} headingRef={headingRef}>{t('ui.failed.title')}</StateHeading>
          <p className="text-sm text-muted-foreground">{t('ui.failed.body')}</p>
        </div>
      )

    case 'awaiting_ratification':
      if (state.isRatifier && state.candidates) {
        return (
          <InterviewRatifyPanel round={state.round} candidates={state.candidates} answers={state.answers} onRatified={() => router.refresh()} />
        )
      }
      return (
        <div data-state="awaiting-ratification" className="space-y-2 max-w-lg">
          <StateHeading icon={Users} headingRef={headingRef}>{t('ui.awaiting_ratification.author_title')}</StateHeading>
          <p className="text-sm text-muted-foreground">{t('ui.awaiting_ratification.author_body')}</p>
        </div>
      )

    case 'ratified':
      return (
        <div data-state="ratified" className="space-y-2 max-w-lg">
          <StateHeading icon={CheckCircle2} headingRef={headingRef}>{t('ui.ratified.title')}</StateHeading>
          <p className="text-sm text-muted-foreground">
            {t('ui.ratified.counts', { accepted: state.round.accepted, rejected: state.round.rejected, edited: state.round.edited })}
          </p>
        </div>
      )

    case 'no_records':
      return (
        <div data-state="no-records" className="space-y-2 max-w-lg">
          <StateHeading icon={FileX} headingRef={headingRef}>{t('ui.no_records.title')}</StateHeading>
          <p className="text-sm text-muted-foreground">
            {t('ui.no_records.body', {
              proposed: state.round.items_proposed,
              ungrounded: state.round.dropped_ungrounded,
              performance: state.round.dropped_performance_claim,
            })}
          </p>
        </div>
      )

    case 'skipped':
      return (
        <div data-state="skipped" className="space-y-2 max-w-lg">
          <StateHeading icon={SkipForward} headingRef={headingRef}>{t('ui.skipped.title')}</StateHeading>
          <p className="text-sm text-muted-foreground">{t('ui.skipped.body')}</p>
        </div>
      )

    case 'expired':
      return (
        <div data-state="expired" className="space-y-2 max-w-lg">
          <StateHeading icon={CalendarX} headingRef={headingRef}>{t('ui.expired.title')}</StateHeading>
          <p className="text-sm text-muted-foreground">{t('ui.expired.body')}</p>
        </div>
      )
  }
}

// ─── Answering (§8.3, §8.7) ─────────────────────────────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function InterviewAnswerPanel({
  round,
  initialAnswers,
  onRoundChanged,
}: {
  round: { id: string }
  initialAnswers: FounderInterviewAnswerRow[]
  onRoundChanged: () => void
}) {
  const t = useTranslations('interview')
  const [answers, setAnswers] = useState(initialAnswers)
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(initialAnswers.map((a) => [a.id, a.answer_text ?? ''])))
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [isPending, startTransition] = useTransition()
  const firstTextareaRef = useRef<HTMLTextAreaElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)

  // §8.7: after Start, focus moves to the first question. This component mounts exactly when a round
  // transitions to 'open' (fresh Start) or the page is loaded/refreshed while open — both are the right time.
  useEffect(() => {
    requestAnimationFrame(() => firstTextareaRef.current?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pending = answers.filter((a) => a.status !== 'skipped')
  const answeredCount = answers.filter((a) => a.status === 'answered').length

  function saveAnswer(answerId: string) {
    const text = (drafts[answerId] ?? '').trim()
    if (text.length === 0) return
    setSaveStatus((s) => ({ ...s, [answerId]: 'saving' }))
    startTransition(async () => {
      const result = await saveInterviewAnswerAction({ answerId, text })
      if (result.ok && result.result.outcome === 'ok') {
        setSaveStatus((s) => ({ ...s, [answerId]: 'saved' }))
        setAnswers((prev) => prev.map((a) => (a.id === answerId ? { ...a, status: 'answered', answer_text: text, char_count: text.length } : a)))
      } else {
        setSaveStatus((s) => ({ ...s, [answerId]: 'error' }))
      }
    })
  }

  function skipQuestion(answerId: string) {
    startTransition(async () => {
      const result = await skipInterviewQuestionAction({ answerId })
      if (result.ok) setAnswers((prev) => prev.map((a) => (a.id === answerId ? { ...a, status: 'skipped' } : a)))
    })
  }

  function handleSubmit() {
    if (answeredCount === 0) {
      setSubmitAttempted(true)
      requestAnimationFrame(() => errorRef.current?.focus())
      return
    }
    startTransition(async () => {
      const result = await submitInterviewRoundAction({ roundId: round.id })
      if (result.ok) onRoundChanged()
    })
  }

  function handleSkipRound() {
    startTransition(async () => {
      const result = await skipInterviewRoundAction({ roundId: round.id })
      if (result.ok) onRoundChanged()
    })
  }

  return (
    <div className="max-w-xl space-y-8" data-state="in-progress">
      <p aria-live="polite" className="text-sm font-medium">
        {t('ui.in_progress.progress', { answered: answeredCount, total: pending.length })}
      </p>

      <ul className="space-y-8">
        {pending.map((answer, idx) => (
          <li key={answer.id}>
            <InterviewQuestionCard
              answer={answer}
              draft={drafts[answer.id] ?? ''}
              onDraftChange={(value) => setDrafts((d) => ({ ...d, [answer.id]: value }))}
              onSave={() => saveAnswer(answer.id)}
              onSkip={() => skipQuestion(answer.id)}
              saveStatus={saveStatus[answer.id] ?? 'idle'}
              textareaRef={idx === 0 ? firstTextareaRef : undefined}
            />
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-4 pt-2 border-t">
        <Button onClick={handleSubmit} disabled={isPending}>
          {t('ui.in_progress.submit')}
        </Button>
        <button
          type="button"
          onClick={handleSkipRound}
          disabled={isPending}
          className="flex min-h-11 items-center rounded-sm px-1 text-sm text-muted-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {t('ui.in_progress.skip_round')}
        </button>
      </div>
      {submitAttempted && answeredCount === 0 && (
        <p ref={errorRef} tabIndex={-1} className="text-sm text-destructive outline-none">
          {t('ui.in_progress.no_answers_error')}
        </p>
      )}
    </div>
  )
}

function InterviewQuestionCard({
  answer,
  draft,
  onDraftChange,
  onSave,
  onSkip,
  saveStatus,
  textareaRef,
}: {
  answer: FounderInterviewAnswerRow
  draft: string
  onDraftChange: (value: string) => void
  onSave: () => void
  onSkip: () => void
  saveStatus: SaveStatus
  textareaRef?: React.Ref<HTMLTextAreaElement>
}) {
  const t = useTranslations('interview')
  const id = `q-${answer.id}`
  const whyId = `${id}-why`
  const counterId = `${id}-counter`
  const [announcement, setAnnouncement] = useState('')
  const pct = (draft.length / INTERVIEW_ANSWER_MAX_CHARS) * 100
  const crossedFull = pct >= 100
  const crossed80 = pct >= 80

  // §8.7: the counter is announced POLITELY at 80% and 100% only — the effect's dependency array keys on the
  // two BOOLEAN crossings, not on draft.length, so it never re-fires per keystroke.
  useEffect(() => {
    if (crossedFull) setAnnouncement(t('ui.question.counter_full'))
    else if (crossed80) setAnnouncement(t('ui.question.counter_80', { remaining: Math.max(0, INTERVIEW_ANSWER_MAX_CHARS - draft.length) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossed80, crossedFull])

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-base font-medium">
        {t(questionMessagePath(answer.question_key) as never)}
      </label>
      <p id={whyId} className="text-sm text-muted-foreground">
        {t(whyMessagePath(answer.slot_category as never) as never)}
      </p>
      <Textarea
        id={id}
        ref={textareaRef}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={onSave}
        maxLength={INTERVIEW_ANSWER_MAX_CHARS}
        aria-describedby={`${whyId} ${counterId}`}
        rows={4}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span id={counterId}>{t('ui.question.counter', { count: draft.length, max: INTERVIEW_ANSWER_MAX_CHARS })}</span>
        <span aria-live="polite" className="sr-only">
          {announcement}
        </span>
        <div className="flex items-center gap-3">
          <span aria-live="polite">{saveStatus === 'saved' ? t('ui.in_progress.saved') : saveStatus === 'error' ? t('ui.in_progress.save_error') : ''}</span>
          <button type="button" onClick={onSave} className="flex min-h-11 items-center rounded-sm px-1 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            {t('ui.in_progress.save')}
          </button>
          <button type="button" onClick={onSkip} className="flex min-h-11 items-center rounded-sm px-1 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            {t('ui.in_progress.skip_question')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Ratification (§8.4, §8.7) ──────────────────────────────────────────────────────────────────────────────

type RatifyItem = {
  key: string
  type: FounderInterviewSlotType
  id: string
  text: string
  category: string
  span: string | null
  spanRedacted: boolean
  question: string | null
}

function itemsFromCandidates(candidates: InterviewCandidatesByType, answers: FounderInterviewAnswerRow[], t: ReturnType<typeof useTranslations>): RatifyItem[] {
  const answerById = new Map(answers.map((a) => [a.id, a]))
  const question = (answerId: string | null): string | null => {
    if (!answerId) return null
    const answer = answerById.get(answerId)
    return answer ? t(questionMessagePath(answer.question_key) as never) : null
  }
  return [
    ...candidates.brand.map((row) => ({
      key: `brand:${row.id}`,
      type: 'brand' as const,
      id: row.id,
      text: row.statement,
      category: row.category,
      span: row.interview_span,
      spanRedacted: row.interview_span_redacted_at !== null,
      question: question(row.interview_answer_id),
    })),
    ...candidates.audience.map((row) => ({
      key: `audience:${row.id}`,
      type: 'audience' as const,
      id: row.id,
      text: row.statement,
      category: row.kind,
      span: row.interview_span,
      spanRedacted: row.interview_span_redacted_at !== null,
      question: question(row.interview_answer_id),
    })),
    ...candidates.evidence.map((row) => ({
      key: `evidence:${row.id}`,
      type: 'evidence' as const,
      id: row.id,
      text: row.content,
      category: row.kind,
      span: row.interview_span,
      spanRedacted: row.interview_span_redacted_at !== null,
      question: question(row.interview_answer_id),
    })),
  ]
}

export function InterviewRatifyPanel({
  round,
  candidates,
  answers,
  onRatified,
}: {
  round: { id: string }
  candidates: InterviewCandidatesByType
  answers: FounderInterviewAnswerRow[]
  onRatified: () => void
}) {
  const t = useTranslations('interview')
  const items = itemsFromCandidates(candidates, answers, t)
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'reject'>>({})
  const [editedText, setEditedText] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.key, i.text])))
  const [editedCategory, setEditedCategory] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.key, i.category])))
  const [isPending, startTransition] = useTransition()
  const statusRef = useRef<HTMLParagraphElement>(null)

  const allDecided = items.length > 0 && items.every((i) => decisions[i.key] !== undefined)

  function handleRatify() {
    const decisionsPayload = items.map((item) => {
      const decision = decisions[item.key]
      if (decision !== 'accept') {
        return { type: item.type, id: item.id, decision: 'reject' as const }
      }
      return {
        type: item.type,
        id: item.id,
        decision: 'accept' as const,
        category: editedCategory[item.key],
        ...(item.type !== 'evidence' ? { text: editedText[item.key] } : {}),
      }
    })
    startTransition(async () => {
      const result = await ratifyInterviewRoundAction({ roundId: round.id, decisions: decisionsPayload })
      if (result.ok) {
        onRatified()
        requestAnimationFrame(() => statusRef.current?.focus())
      }
    })
  }

  const groups: { type: FounderInterviewSlotType; titleKey: string }[] = [
    { type: 'brand', titleKey: 'ui.ratify.group_brand' },
    { type: 'audience', titleKey: 'ui.ratify.group_audience' },
    { type: 'evidence', titleKey: 'ui.ratify.group_evidence' },
  ]

  return (
    <div className="max-w-2xl space-y-8" data-state="awaiting-ratification-ratify">
      <div>
        <h1 className="text-xl font-semibold">{t('ui.awaiting_ratification.ratify_title')}</h1>
        <p className="text-sm text-muted-foreground">{t('ui.awaiting_ratification.ratify_body')}</p>
      </div>

      {groups.map(({ type, titleKey }) => {
        const groupItems = items.filter((i) => i.type === type)
        if (groupItems.length === 0) return null
        return (
          <div key={type} className="space-y-3">
            <h2 className="text-sm font-medium">{t(titleKey as never)}</h2>
            <ul className="space-y-3">
              {groupItems.map((item) => (
                <li key={item.key} className="rounded-lg border p-4 space-y-3" data-candidate-id={item.id}>
                  {item.type === 'evidence' ? (
                    <p className="text-sm">{item.text}</p>
                  ) : (
                    <div className="space-y-1">
                      <label htmlFor={`text-${item.key}`} className="text-xs text-muted-foreground">
                        {t('ui.ratify.edit_label')}
                      </label>
                      <Textarea
                        id={`text-${item.key}`}
                        value={editedText[item.key]}
                        onChange={(e) => setEditedText((prev) => ({ ...prev, [item.key]: e.target.value }))}
                        maxLength={INTERVIEW_RECORD_TEXT_MAX_CHARS}
                        rows={2}
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <label htmlFor={`cat-${item.key}`} className="text-xs text-muted-foreground">
                      {t('ui.ratify.category_label')}
                    </label>
                    <select
                      id={`cat-${item.key}`}
                      value={editedCategory[item.key]}
                      onChange={(e) => setEditedCategory((prev) => ({ ...prev, [item.key]: e.target.value }))}
                      className="flex min-h-11 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {CATEGORY_OPTIONS[item.type].map((cat) => (
                        <option key={cat} value={cat}>
                          {t(`ui.ratify.categories.${cat}` as never)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* §8.4/§8.7: the answer span is quoted beneath the record, never hidden or collapsed by default,
                      with the question it answered — the ADR's own accessibility floor for this list. */}
                  <blockquote className="border-l-2 pl-3 text-xs text-muted-foreground space-y-1">
                    {item.question && <p>{item.question}</p>}
                    <p>{item.spanRedacted || item.span === null ? t('ui.ratify.span_redacted') : `"${item.span}"`}</p>
                  </blockquote>

                  {item.type === 'evidence' && <p className="text-xs text-muted-foreground">{t('ui.ratify.evidence_permission_off')}</p>}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={t('ui.ratify.accept_for', { text: item.text })}
                      aria-pressed={decisions[item.key] === 'accept'}
                      onClick={() => setDecisions((d) => ({ ...d, [item.key]: 'accept' }))}
                      className={`min-h-11 rounded-md px-3 text-sm ${decisions[item.key] === 'accept' ? 'bg-primary text-primary-foreground' : 'border border-input'}`}
                    >
                      {t('ui.ratify.accept')}
                    </button>
                    <button
                      type="button"
                      aria-label={t('ui.ratify.reject_for', { text: item.text })}
                      aria-pressed={decisions[item.key] === 'reject'}
                      onClick={() => setDecisions((d) => ({ ...d, [item.key]: 'reject' }))}
                      className={`min-h-11 rounded-md px-3 text-sm ${decisions[item.key] === 'reject' ? 'bg-destructive text-white' : 'border border-input'}`}
                    >
                      {t('ui.ratify.reject')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      <div className="space-y-2 pt-2 border-t">
        <Button onClick={handleRatify} disabled={isPending || !allDecided}>
          {t('ui.awaiting_ratification.ratify_button')}
        </Button>
        {!allDecided && <p className="text-xs text-muted-foreground">{t('ui.awaiting_ratification.decide_all_hint')}</p>}
        <p ref={statusRef} tabIndex={-1} className="sr-only outline-none" aria-live="polite" />
      </div>
    </div>
  )
}
