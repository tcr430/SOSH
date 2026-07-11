'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { processInviteAccept, type AcceptInviteState } from './actions'
import type { InvitePreview } from '@/lib/members/invite-preview'

const initialState: AcceptInviteState = { status: 'pending' }

export function AcceptClient({
  preview,
  token,
  code,
  locale,
}: {
  preview: InvitePreview
  token: string
  code?: string
  locale: string
}) {
  const t = useTranslations('auth')
  const [state, action, isPending] = useActionState(processInviteAccept, initialState)
  const formRef = useRef<HTMLFormElement>(null)
  const hasSubmitted = useRef(false)

  useEffect(() => {
    if (hasSubmitted.current) return
    hasSubmitted.current = true
    formRef.current?.requestSubmit()
  }, [])

  const roleLabel = t(`invite.accept.role.${preview.role}` as Parameters<typeof t>[0])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 text-center" aria-live="polite">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('invite.accept.invited_heading', { businessName: preview.businessName })}
          </h1>
          {preview.inviterName && (
            <p className="text-sm text-muted-foreground">
              {t('invite.accept.invited_by', {
                inviterName: preview.inviterName,
                roleLabel,
              })}
            </p>
          )}
        </div>

        {/* Auto-submitted on mount — carries no visible or focusable controls,
            so no aria-hidden/tabindex workaround is needed. */}
        <form ref={formRef} action={action}>
          <input type="hidden" name="token" value={token} />
          {code && <input type="hidden" name="code" value={code} />}
          <input type="hidden" name="locale" value={locale} />
        </form>

        {(isPending || state.status === 'pending') && (
          <p className="text-sm text-muted-foreground">
            {t('invite.accept.loading', { businessName: preview.businessName })}
          </p>
        )}

        {state.status === 'already-member' && (
          <div className="space-y-3">
            <p className="text-sm text-foreground">{t('invite.accept.already_member.heading')}</p>
            <Link
              href={`/${locale}/campaigns`}
              className="inline-block text-sm font-medium underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              {t('invite.accept.already_member.cta')}
            </Link>
          </div>
        )}

        {state.status === 'invalid' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('invite.accept.invalid')}</p>
            <Link
              href={`/${locale}/login`}
              className="inline-block text-sm font-medium underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              {t('invite.accept.go_to_login')}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
