'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { approveBriefAction, rejectBriefAction, editBriefAction } from './actions'
import type { CampaignBriefRow } from '@/lib/db/types'

interface BriefReviewFormProps {
  campaignId: string
  brief: CampaignBriefRow
}

// brief.critique is open-shape (Record<string, unknown> | null, ADR 0017 §6.2
// — tightened only once B2.5's RubricOutput type stabilizes) — validate the
// one field this surface renders rather than trusting a raw cast.
function getCritiqueLines(critique: Record<string, unknown> | null): string[] {
  const lines = critique?.critique
  if (!Array.isArray(lines)) return []
  return lines.filter((line): line is string => typeof line === 'string')
}

// ADR 0017 §10 — the MINIMAL functional surface: plain shadcn v4 / Base UI,
// no impeccable/taste-skill pass, no rich per-post diff. Three thin
// useActionState forms over the B2.1 atomic transitions + the B2.5 HARD
// gate. The high-touch brief-edit/Studio-diff surface is Session 24-UI.
export function BriefReviewForm({ campaignId, brief }: BriefReviewFormProps) {
  const t = useTranslations('campaigns.brief')
  const router = useRouter()

  const [approveState, approveFormAction, approvePending] = useActionState(approveBriefAction, { status: 'idle' as const })
  const [rejectState, rejectFormAction, rejectPending] = useActionState(rejectBriefAction, { status: 'idle' as const })
  const [editState, editFormAction, editPending] = useActionState(editBriefAction, { status: 'idle' as const })

  const [narrative, setNarrative] = useState(brief.content.narrative)
  const [proofPlan, setProofPlan] = useState(brief.content.proofPlan)

  useEffect(() => {
    if (approveState.status === 'approved' || rejectState.status === 'rejected' || editState.status === 'saved') {
      router.refresh()
    }
  }, [approveState.status, rejectState.status, editState.status, router])

  // Session 24-D (NIT-1 correction) — approved_success/rejected_success/
  // saved_success were authored in all three locales but never consumed;
  // router.refresh() alone gave no user-facing approve/reject/edit feedback.
  // Computed once, ABOVE the status switch below, so it renders regardless
  // of which branch the switch takes — approve transitions brief.status to
  // 'approved'/'generated' (an early-return branch), while reject/edit keep
  // it 'critiqued' (the main render path); the confirmation must survive
  // either.
  const successMessage =
    approveState.status === 'approved'
      ? t('approved_success')
      : rejectState.status === 'rejected'
        ? t('rejected_success')
        : editState.status === 'saved'
          ? t('saved_success')
          : null

  // Session 24-D (NIT-2 correction) — was called twice (length check + map)
  // on the same brief.critique input; hoisted to one call.
  const critiqueLines = getCritiqueLines(brief.critique)

  switch (brief.status) {
    case 'draft':
      return (
        <>
          {successMessage && <p role="status" className="text-sm text-emerald-600">{successMessage}</p>}
          <p className="text-sm text-muted-foreground">{t('pending')}</p>
        </>
      )
    case 'approved':
    case 'generated':
      return (
        <>
          {successMessage && <p role="status" className="text-sm text-emerald-600">{successMessage}</p>}
          <p className="text-sm text-muted-foreground">{t('already_approved')}</p>
        </>
      )
    case 'critiqued':
      break
    default: {
      const _exhaustive: never = brief.status
      throw new Error(`Unhandled brief status: ${_exhaustive}`)
    }
  }

  return (
    <div className="space-y-6">
      {successMessage && <p role="status" className="text-sm text-emerald-600">{successMessage}</p>}
      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-1">{t('narrative_label')}</h2>
          <p className="text-sm leading-relaxed">{brief.content.narrative}</p>
        </div>
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-1">{t('proof_plan_label')}</h2>
          <p className="text-sm leading-relaxed">{brief.content.proofPlan}</p>
        </div>
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-1">{t('role_sequence_label')}</h2>
          <ul className="space-y-1 text-sm">
            {brief.content.roleSequence.map((entry) => (
              <li key={entry.order} className="flex gap-2">
                <span className="text-muted-foreground">{entry.platform} · {entry.role}</span>
                <span>{entry.angle}</span>
              </li>
            ))}
          </ul>
        </div>
        {brief.overall_score !== null && (
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-1">
              {t('critique_label')} — {t('score_label', { score: brief.overall_score })}
            </h2>
            {critiqueLines.length > 0 && (
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {/* NIT-4 (Session 24-D) — key={i}: low-risk (critiqueLines is an
                    immutable, server-derived array rendered once per brief
                    critique, never reordered/filtered client-side), but the
                    same "index as key" class the logger TODOs below track. */}
                {critiqueLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {approveState.status === 'gate_refused' && (
        <p role="alert" className="text-sm text-destructive">
          {t('gate_refused', { score: approveState.overallScore })}
        </p>
      )}
      {approveState.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">{t(`error_${approveState.error}`)}</p>
      )}
      {rejectState.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">{t(`error_${rejectState.error}`)}</p>
      )}
      {editState.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">{t(`error_${editState.error}`)}</p>
      )}

      <div className="flex gap-3">
        <form action={approveFormAction}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <button
            type="submit"
            disabled={approvePending}
            className={cn(buttonVariants({ size: 'sm' }), 'disabled:opacity-50 disabled:cursor-not-allowed')}
          >
            {t('approve')}
          </button>
        </form>

        <form action={rejectFormAction}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="expectedVersion" value={brief.version} />
          <button
            type="submit"
            disabled={rejectPending}
            className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'disabled:opacity-50 disabled:cursor-not-allowed')}
          >
            {t('reject')}
          </button>
        </form>
      </div>

      <form action={editFormAction} className="space-y-4 rounded-lg border border-border p-6">
        <input type="hidden" name="campaignId" value={campaignId} />
        <input type="hidden" name="expectedVersion" value={brief.version} />
        <div className="space-y-1.5">
          <label htmlFor="narrative" className="text-sm font-medium">{t('edit_narrative_field')}</label>
          <textarea
            id="narrative"
            name="narrative"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="proofPlan" className="text-sm font-medium">{t('edit_proof_plan_field')}</label>
          <textarea
            id="proofPlan"
            name="proofPlan"
            value={proofPlan}
            onChange={(e) => setProofPlan(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={editPending}
          className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'disabled:opacity-50 disabled:cursor-not-allowed')}
        >
          {t('edit')}
        </button>
      </form>
    </div>
  )
}
