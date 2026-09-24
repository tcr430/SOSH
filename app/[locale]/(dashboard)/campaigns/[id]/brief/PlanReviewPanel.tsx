'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  applyPlanProposalsAction,
  decidePlanProposalAction,
  recritiqueBriefAction,
  type ApplyPlanProposalsState,
  type DecidePlanProposalState,
  type RecritiqueBriefState,
} from './plan-actions'
import type { CampaignBriefRow, PlanAnalysisReason } from '@/lib/db/types'

// ADR 0027 §8 (Session 34 K2.10) — the planner's proposals, inside the EXISTING brief-review surface (no new
// route). Every state in §8.2 renders here, and the FIRST FIVE ARE FIVE DISTINCT STATES, not three:
//   not_run · proposed n · proposed nothing · unavailable <reason> · paused (daily limit)
// §3.3's whole argument rests on those being separately legible, so they are driven from the PERSISTED
// campaign_briefs.plan_analysis_status / plan_analysis_reason (passed in by the Server Component page that read
// the row), never from a derived prop.
//
// DESIGN (taste-skill + impeccable, recorded in the K2.10 commit body): an annotated LEDGER, not a card list. Each
// proposal is a row — the entry it concerns, then the change as a plain sentence — and THE PLANNER'S ASSESSMENT
// sits beside it as a margin note: a dashed rule, italic, muted, under an explicit label. It is deliberately the
// one element that looks provisional. It carries no badge, no tick, no colour that reads as a verdict, because it
// is model prose with NO ORACLE (§5.2) and must never look like anything that has one.
//
// EVERYTHING here is PLAIN TEXT: the reason and every entry field render as React text nodes — never markdown,
// never HTML — which closes ADR 0020 §7.1's markdown-image exfiltration vector by construction.
// AGENCY-NO-UNSAFE-HTML scans this directory for the escape hatch.
//
// NO BULK ACCEPT-ALL. A ratification ROUND is an explicit multi-select applied in one call; there is no "select
// all" and no "accept all" verb anywhere on this surface. Reject is the only single-proposal verb.

export type PlanProposalView = {
  id: string
  kind: 'drop' | 'substitute' | 'reorder' | 'request_evidence'
  targetOrder: number
  proposedRole: string | null
  proposedOrder: number | null
  reason: string
  status: 'pending' | 'accepted' | 'rejected' | 'superseded'
  supersededReason: 'version_advanced' | 'brief_frozen' | null
  briefVersion: number
}

export type RoleSequenceView = Array<{ order: number; role: string; platform: string; angle: string }>

interface PlanReviewPanelProps {
  campaignId: string
  briefVersion: number
  briefStatus: CampaignBriefRow['status']
  planStatus: CampaignBriefRow['plan_analysis_status']
  planReason: PlanAnalysisReason | null
  proposals: PlanProposalView[]
  roleSequence: RoleSequenceView
  canAuthor: boolean
}

const APPLY_FORM_ID = 'plan-apply-round'
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

// The margin note. A top-level component (not defined inside the panel, which would remount it every render).
function Assessment({ label, reason }: { label: string; reason: string }) {
  return (
    <blockquote className="mt-2 border-l border-dashed border-muted-foreground/50 pl-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {/* PLAIN TEXT. A React text node: never markdown, never HTML. */}
      <p className="text-sm italic leading-relaxed text-muted-foreground">{reason}</p>
    </blockquote>
  )
}

export function PlanReviewPanel({
  campaignId,
  briefVersion,
  briefStatus,
  planStatus,
  planReason,
  proposals,
  roleSequence,
  canAuthor,
}: PlanReviewPanelProps) {
  const t = useTranslations('agency.planner')
  const tOutcome = useTranslations('outcome')
  const router = useRouter()

  const [applyState, applyFormAction, applyPending] = useActionState(applyPlanProposalsAction, { status: 'idle' } as ApplyPlanProposalsState)
  const [decideState, decideFormAction, decidePending] = useActionState(decidePlanProposalAction, { status: 'idle' } as DecidePlanProposalState)
  const [recritiqueState, recritiqueFormAction, recritiquePending] = useActionState(recritiqueBriefAction, { status: 'idle' } as RecritiqueBriefState)
  // Explicit selection only. The parent keys this component on brief id + version, so a ratified round (which
  // advances the version) remounts it with an empty selection.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (applyState.status === 'applied' || decideState.status === 'rejected' || recritiqueState.status === 'recritiqued') {
      router.refresh()
    }
  }, [applyState.status, decideState.status, recritiqueState.status, router])

  const pending = proposals.filter((p) => p.status === 'pending')
  const decided = proposals.filter((p) => p.status !== 'pending')
  const selectable = canAuthor && briefStatus === 'critiqued'

  // THE FIVE PLANNER STATES — one sentence each, from the persisted column.
  let stateLine: string
  switch (planStatus) {
    case 'not_run':
      stateLine = t('state.not_run')
      break
    case 'capped':
      stateLine = t('state.capped')
      break
    case 'unavailable':
      stateLine = t('state.unavailable', { reason: t(`reason.${planReason ?? 'internal_error'}`) })
      break
    case 'ok':
      stateLine = proposals.length === 0 ? t('state.proposed_nothing') : t('state.proposed', { count: proposals.length })
      break
    default: {
      const _exhaustive: never = planStatus
      throw new Error(`Unhandled plan_analysis_status: ${_exhaustive}`)
    }
  }

  const entryFor = (p: PlanProposalView) =>
    p.briefVersion === briefVersion ? roleSequence.find((e) => e.order === p.targetOrder) : undefined

  function kindText(p: PlanProposalView): string {
    switch (p.kind) {
      case 'drop':
        return t('proposal.kind.drop')
      case 'substitute':
        return t('proposal.kind.substitute', { role: p.proposedRole ? tOutcome(`role.${p.proposedRole}`) : '' })
      case 'reorder':
        return t('proposal.kind.reorder', { position: (p.proposedOrder ?? 0) + 1 })
      case 'request_evidence':
        return t('proposal.kind.request_evidence')
      default: {
        const _exhaustive: never = p.kind
        throw new Error(`Unhandled proposal kind: ${_exhaustive}`)
      }
    }
  }

  function alreadyText(s: Extract<DecidePlanProposalState, { status: 'already_decided' }>): string {
    if (s.currentStatus === 'accepted') return t('result.already.accepted')
    if (s.currentStatus === 'rejected') return t('result.already.rejected')
    if (s.currentStatus === 'superseded') {
      return s.supersededReason === 'brief_frozen' ? t('result.already.superseded_brief_frozen') : t('result.already.superseded_version_advanced')
    }
    return t('result.already.unknown')
  }

  return (
    <section aria-labelledby="plan-review-heading" className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 id="plan-review-heading" className="text-sm font-medium">{t('heading')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{stateLine}</p>
      </div>

      {/* Transient state (§8.2, [cr-MINOR-2]): Approve is absent WITH AN EXPLANATION, never silently gone. */}
      {briefStatus === 'draft' && (
        <div role="status" className="border-t border-border pt-3 text-sm">
          <p className="font-medium">{t('transient.heading')}</p>
          <p className="mt-1 text-muted-foreground">{t('transient.body')}</p>
          {canAuthor && (
            <form action={recritiqueFormAction} className="mt-2">
              <input type="hidden" name="campaignId" value={campaignId} />
              <button
                type="submit"
                disabled={recritiquePending}
                className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), focusRing, 'disabled:cursor-not-allowed disabled:opacity-50')}
              >
                {t('transient.retry')}
              </button>
            </form>
          )}
          {recritiqueState.status === 'error' && (
            <p role="alert" className="mt-2 text-sm text-destructive">{t(`error.${recritiqueState.error}`)}</p>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('assessment_note')}</p>
          <fieldset className="space-y-0">
            <legend className="sr-only">{t('round.legend')}</legend>
            <ul className="divide-y divide-border">
              {pending.map((p) => {
                const entry = entryFor(p)
                const titleId = `plan-proposal-${p.id}`
                return (
                  <li key={p.id} className="grid grid-cols-[auto_1fr] gap-x-3 py-4 first:pt-0">
                    {selectable ? (
                      // The label is the touch target (about 32px, not the 16px box), and the accessible NAME
                      // carries the position as well as the change: three "Drop this post" boxes must not all
                      // announce identically.
                      <label className="-m-1.5 flex h-8 w-8 cursor-pointer items-start justify-center pt-2">
                        <input
                          type="checkbox"
                          name="proposalId"
                          value={p.id}
                          form={APPLY_FORM_ID}
                          aria-labelledby={`${titleId}-position ${titleId}`}
                          checked={selected.has(p.id)}
                          onChange={(e) => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(p.id)
                            else next.delete(p.id)
                            setSelected(next)
                          }}
                          className="h-4 w-4 rounded border-input outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </label>
                    ) : (
                      <span aria-hidden="true" className="size-4" />
                    )}
                    <div className="min-w-0">
                      <p id={`${titleId}-position`} className="text-xs tabular-nums text-muted-foreground">{t('proposal.position', { n: p.targetOrder + 1 })}</p>
                      {entry && (
                        <p className="text-sm text-muted-foreground">
                          {tOutcome(`platform.${entry.platform}`)}, {tOutcome(`role.${entry.role}`)}: {entry.angle}
                        </p>
                      )}
                      <p id={titleId} className="mt-0.5 text-sm font-medium">{kindText(p)}</p>
                      <Assessment label={t('assessment_label')} reason={p.reason} />
                      {canAuthor && (
                        <form action={decideFormAction} className="mt-2">
                          <input type="hidden" name="campaignId" value={campaignId} />
                          <input type="hidden" name="proposalId" value={p.id} />
                          <input type="hidden" name="decision" value="rejected" />
                          <button
                            type="submit"
                            disabled={decidePending}
                            className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), focusRing, 'text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50')}
                          >
                            {t('round.reject')}
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </fieldset>

          {selectable && (
            <form id={APPLY_FORM_ID} action={applyFormAction} className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <input type="hidden" name="campaignId" value={campaignId} />
              <input type="hidden" name="expectedVersion" value={briefVersion} />
              <button
                type="submit"
                disabled={applyPending || selected.size === 0}
                className={cn(buttonVariants({ size: 'sm' }), focusRing, 'disabled:cursor-not-allowed disabled:opacity-50')}
              >
                {t('round.apply', { count: selected.size })}
              </button>
              <p className="text-xs text-muted-foreground">{selected.size === 0 ? t('round.apply_hint') : t('round.note')}</p>
            </form>
          )}
        </div>
      )}

      {/* Results. ONE persistent polite live region: a role=status node that is mounted together with its text is
          frequently not announced, so the container is always present and only its content changes. Failures are
          role=alert (assertive, and reliably announced on insertion). */}
      <div role="status" aria-live="polite" className="empty:hidden text-sm">
        {applyState.status === 'applied' && (
          <p>
            {applyState.recritiqued
              ? t('result.applied', { count: applyState.appliedCount })
              : t('result.applied_recheck_pending', { count: applyState.appliedCount })}
          </p>
        )}
        {decideState.status === 'rejected' && <p>{t('result.rejected')}</p>}
        {decideState.status === 'already_decided' && (
          // THAT proposal's real state, not a generic error.
          <p>{alreadyText(decideState)}</p>
        )}
      </div>
      {applyState.status === 'conflict' && <p role="alert" className="text-sm text-destructive">{t(`conflict.${applyState.reason}`)}</p>}
      {applyState.status === 'error' && <p role="alert" className="text-sm text-destructive">{t(`error.${applyState.error}`)}</p>}
      {decideState.status === 'error' && <p role="alert" className="text-sm text-destructive">{t(`error.${decideState.error}`)}</p>}

      {decided.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">{t('round.history_heading')}</h3>
          <ul className="mt-2 divide-y divide-border">
            {decided.map((p) => {
              const entry = entryFor(p)
              return (
                <li key={p.id} className="py-3 first:pt-0">
                  <p className="text-xs tabular-nums text-muted-foreground">{t('proposal.position', { n: p.targetOrder + 1 })}</p>
                  {entry && (
                    <p className="text-sm text-muted-foreground">
                      {tOutcome(`platform.${entry.platform}`)}, {tOutcome(`role.${entry.role}`)}: {entry.angle}
                    </p>
                  )}
                  <p className="mt-0.5 text-sm">
                    <span className="font-medium">{kindText(p)}</span>
                    <span className="text-muted-foreground"> ({t(`proposal.status.${p.status}`)})</span>
                  </p>
                  {p.status === 'superseded' && p.supersededReason && (
                    <p className="text-xs text-muted-foreground">{t(`proposal.superseded_reason.${p.supersededReason}`)}</p>
                  )}
                  <Assessment label={t('assessment_label')} reason={p.reason} />
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
