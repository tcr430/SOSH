'use client'

import { useState, useEffect, useTransition } from 'react'
import { addDays, format, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { promoteDraftToCampaign, type PromoteDraftToCampaignState } from '@/app/[locale]/(dashboard)/studio/actions'
import { toUtcIso } from '@/lib/utils'

// ADR 0022 §2.5/§10 (A-3, Session 29 F1b.5) — promote is TWO STEPS, not one
// click: the user chooses scheduled_at HERE, before promoteDraftToCampaign
// ever fires. Mirrors RegenerateDialog's controlled-open + useTransition
// shape exactly (components/posts/RegenerateDialog.tsx) — the established
// two-step confirm pattern in this codebase, not a third one.

interface PromoteDraftDialogProps {
  draftId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onOutcome: (result: PromoteDraftToCampaignState) => void
}

// datetime-local's value format is LOCAL wall-clock, "yyyy-MM-ddTHH:mm" —
// deliberately NOT toUtcIso (that's for the OUTGOING UTC ISO string this
// component sends to the server, not for the <input>'s own value format).
function toDatetimeLocalValue(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm")
}

function defaultScheduledAtLocal(): string {
  const tomorrowMorning = setMilliseconds(setSeconds(setMinutes(setHours(addDays(new Date(), 1), 9), 0), 0), 0)
  return toDatetimeLocalValue(tomorrowMorning)
}

export function PromoteDraftDialog({ draftId, open, onOpenChange, onOutcome }: PromoteDraftDialogProps) {
  const t = useTranslations('studio.editor.promote')
  const [scheduledAtLocal, setScheduledAtLocal] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScheduledAtLocal(defaultScheduledAtLocal())
    }
  }, [open])

  // Every outcome (including 'error') bubbles to the parent and closes the
  // dialog — "promote failed" is a persistent top-level page state (§10),
  // not a transient in-dialog message that vanishes if the user cancels.
  function handleSubmit() {
    if (!scheduledAtLocal) return
    startTransition(async () => {
      const scheduledAtUtc = toUtcIso(new Date(scheduledAtLocal))
      const result = await promoteDraftToCampaign(draftId, scheduledAtUtc)
      onOutcome(result)
      onOpenChange(false)
    })
  }

  const minLocal = toDatetimeLocalValue(new Date())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={!isPending}>
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label htmlFor="promote-scheduled-at" className="text-sm font-medium">
            {t('dialog.scheduledAtLabel')}
          </label>
          <input
            id="promote-scheduled-at"
            type="datetime-local"
            value={scheduledAtLocal}
            min={minLocal}
            onChange={(e) => setScheduledAtLocal(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('dialog.cancelButton')}
          </button>
          <Button onClick={handleSubmit} disabled={isPending || !scheduledAtLocal}>
            {isPending ? t('dialog.confirmButtonSubmitting') : t('dialog.confirmButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
