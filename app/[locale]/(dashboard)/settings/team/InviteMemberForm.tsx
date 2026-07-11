'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { inviteMemberAction, type ActionState } from './actions'

const initialState: ActionState = {}

export function InviteMemberForm({ disabled }: { disabled: boolean }) {
  const t = useTranslations('team')
  const [state, action, isPending] = useActionState(inviteMemberAction, initialState)

  return (
    <form action={action} className="rounded-lg border p-4 space-y-4">
      <h2 className="text-sm font-medium">{t('invite_form.heading')}</h2>

      {disabled && (
        <p className="text-sm text-muted-foreground" role="status">
          {t('invite_form.disabled_notice')}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">{t('invite_form.fields.email')}</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={disabled}
            aria-describedby={state.error ? 'invite-form-error' : undefined}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-role">{t('invite_form.fields.role')}</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue="viewer"
            disabled={disabled}
            className="h-9 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="viewer">{t('roles.viewer')}</option>
            <option value="editor">{t('roles.editor')}</option>
            <option value="approver">{t('roles.approver')}</option>
          </select>
        </div>

        <div className="flex items-end gap-1.5 pb-2">
          <input
            id="invite-is-admin"
            name="isAdmin"
            type="checkbox"
            value="true"
            disabled={disabled}
            className="h-4 w-4 rounded border-input outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Label htmlFor="invite-is-admin" className="text-sm font-normal">
            {t('invite_form.fields.is_admin')}
          </Label>
        </div>

        <div className="flex items-end">
          <Button type="submit" disabled={disabled || isPending}>
            {isPending ? '…' : t('invite_form.cta')}
          </Button>
        </div>
      </div>

      {state.error && (
        <p id="invite-form-error" className="text-sm text-destructive" role="alert">
          {t(state.error as Parameters<typeof t>[0])}
        </p>
      )}
      {state.success && (
        <p className="text-sm text-foreground" role="status">
          {t('invite_form.sent')}
        </p>
      )}
    </form>
  )
}
