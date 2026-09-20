'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { acknowledgeRetrospectiveAction, type AcknowledgeRetrospectiveState } from './retrospective-actions'

// ADR 0026 §10.4 — the ONLY Client Component on the retrospective surface. The acting user is never a form field:
// the Server Action reads the session. `conclusive` only changes the helper copy (an inconclusive result writes
// nothing to memory).
export function AcknowledgeForm({ campaignId, conclusive }: { campaignId: string; conclusive: boolean }) {
  const t = useTranslations('outcome.retrospective')
  const router = useRouter()
  const [state, formAction, pending] = useActionState<AcknowledgeRetrospectiveState, FormData>(acknowledgeRetrospectiveAction, { status: 'idle' })

  useEffect(() => {
    if (state.status === 'acknowledged') router.refresh()
  }, [state.status, router])

  return (
    <form action={formAction} className="space-y-3 border-t border-border pt-4">
      <input type="hidden" name="campaignId" value={campaignId} />
      <p className="text-sm text-muted-foreground">{t(conclusive ? 'acknowledge_intro' : 'acknowledge_intro_inconclusive')}</p>
      <div className="space-y-1.5">
        <label htmlFor={`retro-note-${campaignId}`} className="text-sm font-medium">{t('note_label')}</label>
        <textarea
          id={`retro-note-${campaignId}`}
          name="note"
          rows={2}
          maxLength={500}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">{t(`error_${state.error}`)}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={cn(buttonVariants({ size: 'sm' }), 'disabled:opacity-50 disabled:cursor-not-allowed')}
      >
        {pending ? t('acknowledge_pending') : t('acknowledge_button')}
      </button>
    </form>
  )
}
