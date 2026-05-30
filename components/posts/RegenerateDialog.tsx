'use client'

import { useState, useEffect, useTransition } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { regeneratePostAction } from '@/app/[locale]/(dashboard)/campaigns/[id]/posts/actions'

interface RegenerateDialogProps {
  postId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (content: string, hashtags: string[]) => void
}

export function RegenerateDialog({
  postId,
  open,
  onOpenChange,
  onSuccess,
}: RegenerateDialogProps) {
  const t = useTranslations('posts')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFeedbackNote('')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(null)
    }
  }, [open])

  function handleSubmit() {
    startTransition(async () => {
      const result = await regeneratePostAction(postId, feedbackNote)
      if (result.success && result.content != null && result.hashtags != null) {
        onSuccess(result.content, result.hashtags)
        onOpenChange(false)
      } else {
        const key = result.error as 'not_eligible' | 'quota_exceeded' | 'generic' | undefined
        if (key === 'not_eligible') setError(t('regenerate.error.not_eligible'))
        else if (key === 'quota_exceeded') setError(t('regenerate.error.quota_exceeded'))
        else setError(t('regenerate.error.generic'))
      }
    })
  }

  const canSubmit = feedbackNote.trim().length >= 5 && !isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={!isPending}>
        <DialogHeader>
          <DialogTitle>{t('regenerate.title')}</DialogTitle>
          <DialogDescription>{t('regenerate.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Textarea
            aria-label={t('regenerate.title')}
            value={feedbackNote}
            onChange={e => setFeedbackNote(e.target.value)}
            placeholder={t('regenerate.placeholder')}
            rows={4}
            disabled={isPending}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground">
            {feedbackNote.trim().length} / {t('regenerate.minChars')}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('card.actions.cancel')}
          </button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isPending ? t('regenerate.submitting') : t('regenerate.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
