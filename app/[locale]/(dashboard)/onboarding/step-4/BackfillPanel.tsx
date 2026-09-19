'use client'

// ADR 0025 §10 (Session 32 I2.14) — the "what we learned" moment. Server
// Component page passes plain data in; this Client Component owns
// accept/reject, accept-all-per-group, discard/retry, role declaration, and
// the bounded poll while a run is queued/fetching/extracting.

import { useState, useEffect, useRef, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { format } from 'date-fns'
import { enUS, pt, es, type Locale } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import {
  ratifyBackfillRunAction,
  discardBackfillRunAction,
  retryBackfillRunAction,
  getBackfillRunsAction,
} from './backfill-actions'
import { strongestAxisLabels } from '@/lib/voice/axis-labels'
import { vectorToVoiceFields } from '@/lib/voice/translate'
import type { VoiceAxes } from '@/lib/validation/voice'
import type {
  SocialBackfillRunRow,
  EvidenceMemoryRow,
  AudienceMemoryRow,
  PerformanceMemoryRow,
  BackfillAccountRole,
} from '@/lib/db/types'
import type { BackfillStatsSummary } from '@/lib/backfill/stats'

const DATE_FNS_LOCALES: Record<string, Locale> = { en: enUS, pt, es }

// ADR 0025 §10.4 item 1 (Session 32-D, D9, MAJOR-12) — the REAL date range
// lib/backfill/stats.ts now writes, never the summary.date_range field
// nothing wrote. Short, locale-aware, no year repeated when both ends fall
// in the same year.
function formatDateRange(dateRange: BackfillStatsSummary['dateRange'], locale: string): string {
  if (!dateRange) return ''
  const dateFnsLocale = DATE_FNS_LOCALES[locale] ?? enUS
  const start = new Date(dateRange.start)
  const end = new Date(dateRange.end)
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  const startStr = format(start, sameYear ? 'MMM d' : 'MMM d, yyyy', { locale: dateFnsLocale })
  const endStr = format(end, 'MMM d, yyyy', { locale: dateFnsLocale })
  return `${startStr} – ${endStr}`
}

// ADR 0025 §10.4 item 6 (Session 32-D, D9, MAJOR-12) — cadence and format
// mix, read from the run's own summary jsonb (lib/backfill/stats.ts),
// never memory. The single most common key by count; ties keep object
// insertion order (stable).
function mostCommonKey(dist: Record<string, number> | undefined): string | null {
  if (!dist) return null
  let best: string | null = null
  let bestCount = -1
  for (const [key, count] of Object.entries(dist)) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

export interface BackfillCandidates {
  evidence: EvidenceMemoryRow[]
  audience: AudienceMemoryRow[]
  performance: PerformanceMemoryRow[]
}

export interface BackfillRunViewModel {
  run: SocialBackfillRunRow
  accountLabel: string
  candidates: BackfillCandidates
}

const POLLING_STATUSES = new Set(['queued', 'fetching', 'extracting'])
const POLL_MS = 4000

export function BackfillPanel({
  locale,
  initialRuns,
  supportedPlatformsLabel,
}: {
  locale: string
  initialRuns: BackfillRunViewModel[]
  supportedPlatformsLabel: string
}) {
  const t = useTranslations('onboarding.backfill')
  const [runs, setRuns] = useState(initialRuns)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    const active = runs.some((vm) => POLLING_STATUSES.has(vm.run.status))
    if (!active) return
    const id = setInterval(() => {
      getBackfillRunsAction().then((fresh) => {
        setRuns((prev) =>
          prev.map((vm) => {
            const match = fresh.find((r) => r.id === vm.run.id)
            return match ? { ...vm, run: match } : vm
          }),
        )
      })
    }, POLL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.map((r) => r.run.status).join(',')])

  const visible = runs.filter((vm) => vm.run.status !== 'discarded' && !dismissed.has(vm.run.id))

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        {t('not_started.body', { platforms: supportedPlatformsLabel })}
      </div>
    )
  }

  return (
    <div className="space-y-4" aria-live="polite">
      {visible.map((vm) => (
        <RunCard
          key={vm.run.id}
          vm={vm}
          locale={locale}
          onDismiss={() => setDismissed((prev) => new Set(prev).add(vm.run.id))}
          onUpdate={(next) =>
            setRuns((prev) => prev.map((p) => (p.run.id === next.id ? { ...p, run: next } : p)))
          }
        />
      ))}
    </div>
  )
}

function RunCard({
  vm,
  locale,
  onDismiss,
  onUpdate,
}: {
  vm: BackfillRunViewModel
  locale: string
  onDismiss: () => void
  onUpdate: (run: SocialBackfillRunRow) => void
}) {
  const t = useTranslations('onboarding.backfill')
  const { run, accountLabel, candidates } = vm
  const [isPending, startTransition] = useTransition()
  const [rejected, setRejected] = useState<Set<string>>(new Set())
  const [accountRole, setAccountRole] = useState<BackfillAccountRole | null>(run.account_role)
  // ADR §10.5 (I2.14, impeccable audit) — focus lands on the card's own
  // status line after ratify/discard/retry, so a screen-reader user isn't
  // left on a control that just disappeared from the DOM.
  const statusRef = useRef<HTMLParagraphElement>(null)
  function focusStatus() {
    requestAnimationFrame(() => statusRef.current?.focus())
  }

  function toggleReject(id: string) {
    setRejected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function acceptAll(ids: string[]) {
    setRejected((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }

  function handleRatify() {
    if (!accountRole) return
    const allIds = [...candidates.evidence, ...candidates.audience, ...candidates.performance].map((c) => c.id)
    const acceptedIds = allIds.filter((id) => !rejected.has(id))
    const rejectedIds = allIds.filter((id) => rejected.has(id))
    startTransition(async () => {
      const result = await ratifyBackfillRunAction({ runId: run.id, acceptedIds, rejectedIds, accountRole })
      if (result.ok) {
        onUpdate(result.run)
        focusStatus()
      }
    })
  }

  function handleDiscard() {
    startTransition(async () => {
      const result = await discardBackfillRunAction({ runId: run.id })
      if (result.ok) {
        onUpdate(result.run)
        focusStatus()
      }
    })
  }

  function handleRetry() {
    startTransition(async () => {
      const result = await retryBackfillRunAction({ runId: run.id })
      if (result.ok) {
        onUpdate(result.run)
        focusStatus()
      }
    })
  }

  const canDiscard = run.status !== 'ratified' && run.status !== 'discarded' && run.status !== 'unsupported'

  return (
    <div className="rounded-lg border p-4 space-y-4" data-run-status={run.status}>
      {renderBody()}
      {canDiscard && (
        <div className="pt-2 border-t">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={isPending}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            {t('actions.discard')}
          </button>
        </div>
      )}
    </div>
  )

  function renderBody() {
    switch (run.status) {
      case 'queued':
      case 'fetching':
      case 'extracting':
        return (
          <div data-state="progress" className="space-y-2">
            <p ref={statusRef} tabIndex={-1} className="text-sm font-medium outline-none">
              {t('progress.title', { account: accountLabel })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('progress.counts', { fetched: run.posts_fetched, extracted: run.posts_extracted })}
            </p>
            <p className="text-xs text-muted-foreground">{t('progress.keep_going')}</p>
          </div>
        )

      case 'unsupported':
        return (
          <div data-state="unsupported" className="space-y-1">
            <p className="text-sm font-medium">{t('unsupported.title', { platform: run.platform })}</p>
            <p className="text-sm text-muted-foreground">{t('unsupported.body')}</p>
          </div>
        )

      case 'failed': {
        const resumable = run.error_code !== 'caller_bug'
        const reasonKey = run.error_code ?? 'unknown'
        return (
          <div data-state="failed" className="space-y-2">
            <p className="text-sm font-medium">{t('failed.title')}</p>
            <p className="text-sm text-muted-foreground">
              {t.has(`failed.reason.${reasonKey}`) ? t(`failed.reason.${reasonKey}` as never) : t('failed.reason.unknown')}
            </p>
            {resumable && (
              <Button size="sm" onClick={handleRetry} disabled={isPending}>
                {t('actions.retry')}
              </Button>
            )}
          </div>
        )
      }

      case 'ratified':
        return (
          <div data-state="ratified" className="space-y-1">
            <p ref={statusRef} tabIndex={-1} className="text-sm font-medium outline-none">
              {t('ratified.title')}
            </p>
            {run.voice_status && run.voice_status !== 'applied' && run.voice_status !== 'declined' && (
              <Link
                href={`/${locale}/onboarding/step-2?run=${run.id}`}
                className="text-sm text-primary underline underline-offset-4"
              >
                {t('voice.review')}
              </Link>
            )}
          </div>
        )

      case 'awaiting_ratification': {
        const totalCandidates = candidates.evidence.length + candidates.audience.length + candidates.performance.length
        // BLOCKER-3 (Session 32-D, D4) — "nothing to learn" means zero
        // candidates in all three groups AND no staged voice, never a bare
        // posts_extracted check: that counter can legitimately be nonzero
        // with zero candidates (every post skipped) and, before D3, was
        // never written at all — silently hiding a real run's candidates.
        if (totalCandidates === 0 && run.staged_voice == null) {
          return (
            <div data-state="nothing-to-learn" className="space-y-1">
              <p className="text-sm font-medium">{t('nothing_to_learn.title', { account: accountLabel })}</p>
              <p className="text-sm text-muted-foreground">{t('nothing_to_learn.body')}</p>
            </div>
          )
        }

        // MAJOR-12 (Session 32-D, D9) — the summary jsonb lib/backfill/stats.ts
        // actually writes (ADR §10.4 items 1 and 6), never a field nothing writes.
        const summary = run.summary as Partial<BackfillStatsSummary> | null
        const stagedVoice = (run.staged_voice ?? null) as { voiceAxes?: VoiceAxes } | null
        const axes = stagedVoice?.voiceAxes
        const cadenceWeekday = mostCommonKey(summary?.weekdayDistribution)
        const cadenceHour = mostCommonKey(summary?.hourDistribution)
        const cadenceFormat = mostCommonKey(summary?.formatDistribution)

        return (
          <div data-state="awaiting-ratification" data-partial={run.partial} className="space-y-4">
            {/* §10.4 item 1 — headline: N posts, account, real date range.
                /impeccable audit (Session 32-D D9): a real heading, not a
                <p>, so the six-item hierarchy is a landmark a screen reader
                can actually navigate by. */}
            <div>
              <h2 className="text-sm font-medium">
                {t('headline.line', {
                  count: run.posts_extracted,
                  account: accountLabel,
                  dateRange: formatDateRange(summary?.dateRange ?? null, locale),
                })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {run.weighting === 'weighted' ? t('headline.weighted') : t('headline.unweighted')}
              </p>
              {run.partial && (
                <p className="text-xs text-destructive mt-1">
                  {t('partial.notice', { extracted: run.posts_extracted })}
                </p>
              )}
            </div>

            {/* §10.4 item 2 — voice summary: descriptor + three strongest axes.
                MAJOR-1 (D8): no "Review voice" link before ratify — voice only
                applies to a ratified run's declared role (ADR §4.2/§10.3).
                /impeccable audit (D9): dropped the bg-muted box — it was the
                only boxed section on an otherwise unboxed page (headline,
                candidate groups and item 6 are all plain); a heading now
                carries the hierarchy instead of a card. */}
            {axes != null && (
              <div className="space-y-1" data-section="voice-summary">
                <h3 className="text-sm font-medium">{t('voice.summary_title')}</h3>
                <p className="text-sm text-muted-foreground">{vectorToVoiceFields(axes).descriptor}</p>
                <p className="text-xs text-muted-foreground">
                  {t('voice.strongest_axes', { axes: strongestAxisLabels(axes, 3).join(', ') })}
                </p>
              </div>
            )}

            {candidates.performance.length > 0 && (
              <CandidateGroup
                title={t('performed.title')}
                items={candidates.performance.map((p) => ({
                  id: p.id,
                  label: t('performed.pattern', { pattern: p.pattern, count: p.observation_count }),
                }))}
                rejected={rejected}
                onToggle={toggleReject}
                onAcceptAll={acceptAll}
                acceptAllLabel={t('actions.accept_all')}
              />
            )}

            {candidates.audience.length > 0 && (
              <CandidateGroup
                title={t('audience.title')}
                items={candidates.audience.map((a) => ({ id: a.id, label: a.statement }))}
                rejected={rejected}
                onToggle={toggleReject}
                onAcceptAll={acceptAll}
                acceptAllLabel={t('actions.accept_all')}
              />
            )}

            {candidates.evidence.length > 0 && (
              <CandidateGroup
                title={t('evidence.title', { count: candidates.evidence.length })}
                items={candidates.evidence.map((e) => ({ id: e.id, label: e.content }))}
                rejected={rejected}
                onToggle={toggleReject}
                onAcceptAll={acceptAll}
                acceptAllLabel={t('actions.accept_all')}
                footnote={t('evidence.permission_off')}
              />
            )}

            {/* §10.4 item 6 — cadence and format mix: context, not memory. */}
            {(cadenceWeekday || cadenceFormat) && (
              <div className="space-y-1" data-section="cadence">
                <h3 className="text-sm font-medium">{t('cadence.title')}</h3>
                {cadenceWeekday && cadenceHour != null && (
                  <p className="text-xs text-muted-foreground">
                    {t('cadence.most_active', {
                      weekday: t(`cadence.weekdays.${cadenceWeekday}` as never),
                      hour: cadenceHour,
                    })}
                  </p>
                )}
                {cadenceFormat && (
                  <p className="text-xs text-muted-foreground">{t('cadence.formats', { formats: cadenceFormat })}</p>
                )}
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('role.question')}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`role-${run.id}`}
                  checked={accountRole === 'founder'}
                  onChange={() => setAccountRole('founder')}
                />
                {t('role.founder')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`role-${run.id}`}
                  checked={accountRole === 'brand'}
                  onChange={() => setAccountRole('brand')}
                />
                {t('role.brand')}
              </label>
            </fieldset>

            <Button onClick={handleRatify} disabled={isPending || !accountRole}>
              {t('actions.ratify')}
            </Button>
          </div>
        )
      }

      default:
        return null
    }
  }
}

function CandidateGroup({
  title,
  items,
  rejected,
  onToggle,
  onAcceptAll,
  acceptAllLabel,
  footnote,
}: {
  title: string
  items: { id: string; label: string }[]
  rejected: Set<string>
  onToggle: (id: string) => void
  onAcceptAll: (ids: string[]) => void
  acceptAllLabel: string
  footnote?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        {/* /impeccable audit (Session 32-D D9) — a heading, matching the
            rest of the §10.4 hierarchy's promoted section titles. */}
        <h3 className="text-sm font-medium">{title}</h3>
        <button
          type="button"
          onClick={() => onAcceptAll(items.map((i) => i.id))}
          className="text-xs text-primary underline underline-offset-4"
        >
          {acceptAllLabel}
        </button>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={!rejected.has(item.id)}
              onChange={() => onToggle(item.id)}
              className="mt-1"
              aria-label={item.label}
            />
            <span className={rejected.has(item.id) ? 'line-through text-muted-foreground' : ''}>{item.label}</span>
          </li>
        ))}
      </ul>
      {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
    </div>
  )
}
