'use client'

import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { addDays, isAfter, parseISO } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  changeMemberRoleAction,
  revokeMemberAction,
  resendInviteAction,
  type ActionState,
} from './actions'
import type { BusinessMemberRow, MemberRole } from '@/lib/db/types'

const INVITE_EXPIRY_DAYS = 7
const initialState: ActionState = {}

function isExpiredInvite(row: BusinessMemberRow): boolean {
  if (row.status !== 'invited') return false
  const expiresAt = addDays(parseISO(row.invited_at), INVITE_EXPIRY_DAYS)
  return isAfter(new Date(), expiresAt)
}

function StatusBadge({ status }: { status: BusinessMemberRow['status'] }) {
  const t = useTranslations('team')
  const variant = status === 'active' ? 'secondary' : status === 'invited' ? 'outline' : 'destructive'
  return <Badge variant={variant}>{t(`status.${status}`)}</Badge>
}

function RoleChangeControl({
  member,
  isOwner,
}: {
  member: BusinessMemberRow
  isOwner: boolean
}) {
  const t = useTranslations('team')
  const [state, action, isPending] = useActionState(changeMemberRoleAction, initialState)
  const [pendingRole, setPendingRole] = useState<MemberRole | null>(null)

  if (isOwner) {
    return <span className="text-sm text-muted-foreground">{t('roles.owner')}</span>
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="memberId" value={member.id} />
      <input type="hidden" name="isAdmin" value={String(member.is_admin)} />
      <select
        name="role"
        defaultValue={member.role}
        onChange={(e) => setPendingRole(e.target.value as MemberRole)}
        className="h-8 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={t('member_row.role_select_label', { email: member.email })}
      >
        <option value="viewer">{t('roles.viewer')}</option>
        <option value="editor">{t('roles.editor')}</option>
        <option value="approver">{t('roles.approver')}</option>
      </select>
      {pendingRole && pendingRole !== member.role && (
        <span className="flex items-center gap-1">
          <Button type="submit" size="sm" variant="outline" disabled={isPending}>
            {t('member_row.confirm_role_change')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPendingRole(null)}
            disabled={isPending}
          >
            {t('member_row.cancel')}
          </Button>
        </span>
      )}
      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {t(state.error as Parameters<typeof t>[0])}
        </span>
      )}
    </form>
  )
}

function ResendButton({ member }: { member: BusinessMemberRow }) {
  const t = useTranslations('team')
  const [state, action, isPending] = useActionState(resendInviteAction, initialState)

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="memberId" value={member.id} />
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? '…' : t('member_row.resend')}
      </Button>
      {state.success && (
        <span role="status" className="text-xs text-muted-foreground">
          {t('member_row.resend_sent')}
        </span>
      )}
      {state.error && (
        <span role="alert" className="text-xs text-destructive">
          {t(state.error as Parameters<typeof t>[0])}
        </span>
      )}
    </form>
  )
}

function RevokeDialog({ member }: { member: BusinessMemberRow }) {
  const t = useTranslations('team')
  const [state, action, isPending] = useActionState(revokeMemberAction, initialState)

  return (
    <AlertDialog>
      <AlertDialogTrigger className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
        {t('member_row.remove')}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('remove_dialog.title', { email: member.email })}</AlertDialogTitle>
          <AlertDialogDescription>{t('remove_dialog.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <form action={action}>
          <input type="hidden" name="memberId" value={member.id} />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('remove_dialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction type="submit" variant="destructive" disabled={isPending}>
              {isPending ? '…' : t('remove_dialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
        {state.error && (
          <p role="alert" className="text-xs text-destructive">
            {t(state.error as Parameters<typeof t>[0])}
          </p>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function MemberRow({
  member,
  isOwner,
  isSelf,
}: {
  member: BusinessMemberRow
  isOwner: boolean
  isSelf: boolean
}) {
  const t = useTranslations('team')

  return (
    <tr className="border-b last:border-0">
      <td className="py-3 pr-4">
        <span className="text-sm text-foreground">{member.email}</span>
        {isSelf && (
          <span className="ml-2 text-xs text-muted-foreground">{t('member_row.you')}</span>
        )}
      </td>
      <td className="py-3 pr-4">
        <RoleChangeControl member={member} isOwner={isOwner} />
      </td>
      <td className="py-3 pr-4">
        <StatusBadge status={member.status} />
      </td>
      <td className="py-3 pr-4">
        {member.is_admin && <Badge variant="outline">{t('member_row.admin_badge')}</Badge>}
      </td>
      <td className="py-3 text-right space-x-2">
        {isExpiredInvite(member) && <ResendButton member={member} />}
        {!isOwner && <RevokeDialog member={member} />}
      </td>
    </tr>
  )
}

export function MemberList({
  members,
  ownerId,
  currentUserId,
}: {
  members: BusinessMemberRow[]
  ownerId: string
  currentUserId: string
}) {
  const t = useTranslations('team')

  return (
    <div className="rounded-lg border">
      <table className="w-full text-left">
        <caption className="sr-only">{t('member_list.caption')}</caption>
        <thead>
          <tr className="border-b text-xs font-medium text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">{t('member_list.columns.email')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('member_list.columns.role')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('member_list.columns.status')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('member_list.columns.admin')}</th>
            <th scope="col" className="px-4 py-3 font-medium text-right">{t('member_list.columns.actions')}</th>
          </tr>
        </thead>
        <tbody className="[&_td]:px-4">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isOwner={member.user_id === ownerId}
              isSelf={member.user_id === currentUserId}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
