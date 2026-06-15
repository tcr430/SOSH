import * as Sentry from '@sentry/nextjs'
import { addMinutes, formatISO } from 'date-fns'
import { config } from '@/lib/config'
import {
  claimDeletionRequests,
  transitionDeletionRequest,
  purgeBusiness,
  getBusinessOwnerId,
  countRemainingBusinesses,
} from '@/lib/db/deletion-requests'

export interface DeletionTickSummary {
  claimed: number
  purged: number
  retried: number
  abandoned: number
  durationMs: number
}

function isPermanentError(e: unknown): boolean {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = String((e as { code: unknown }).code)
    if (code === '23502' || code === '23514') return true
    if (code.startsWith('23')) return true
  }
  return false
}

export function computeBackoff(attempts: number): number {
  const base = config.server.DELETION_RETRY_BACKOFF_BASE_MINUTES
  const exp = base * Math.pow(2, attempts - 1)
  const jitter = exp * (0.75 + Math.random() * 0.5)
  return Math.min(Math.round(jitter), 1440)
}

export async function runDeletionTick(opts: {
  triggeredBy: 'qstash' | 'secret'
}): Promise<DeletionTickSummary> {
  const startedAt = Date.now()
  const summary: DeletionTickSummary = {
    claimed: 0,
    purged: 0,
    retried: 0,
    abandoned: 0,
    durationMs: 0,
  }

  try {
    await Sentry.withMonitor(
      'process-deletions',
      async () => {
        const { createServiceRoleClient } = await import('@/lib/supabase/service')
        const client = createServiceRoleClient()
        const retentionDays = config.server.DELETION_RETENTION_DAYS
        const maxAttempts = config.server.DELETION_MAX_ATTEMPTS

        const rows = await claimDeletionRequests(client, 10, retentionDays, maxAttempts)
        summary.claimed = rows.length

        console.log(
          JSON.stringify({
            kind: 'deletion.tick.start',
            triggeredBy: opts.triggeredBy,
            claimed: summary.claimed,
          }),
        )

        for (const row of rows) {
          try {
            // D2.7: read owner_id BEFORE purge_business deletes the businesses row
            const ownerId = await getBusinessOwnerId(client, row.business_id)

            const purgeResult = await purgeBusiness(client, row.business_id)

            let authUserDeleted = false
            if (ownerId) {
              // Multi-business guard: only delete auth user when no businesses remain
              const remaining = await countRemainingBusinesses(client, ownerId)
              if (remaining === 0) {
                const { error: authError } = await client.auth.admin.deleteUser(ownerId)
                if (authError) throw authError
                authUserDeleted = true
              }
            }

            await transitionDeletionRequest(client, row.id, {
              status: 'completed',
              purged_at: formatISO(new Date()),
            })
            summary.purged += 1

            console.log(
              JSON.stringify({
                kind: 'deletion.row.processed',
                request_id: row.id,
                business_id: row.business_id,
                outcome: 'purged',
                attempts: row.attempts + 1,
                vault_secrets_deleted: purgeResult.already_purged
                  ? 0
                  : purgeResult.vault_secrets_deleted,
                billing_events_redacted: purgeResult.already_purged
                  ? 0
                  : purgeResult.billing_events_redacted,
                auth_user_deleted: authUserDeleted,
              }),
            )
          } catch (err) {
            const permanent = isPermanentError(err)
            const nextAttempts = row.attempts + 1
            const exhausted = nextAttempts >= maxAttempts
            const errorMessage = (
              err instanceof Error ? err.message : String(err)
            ).slice(0, 1000)

            if (permanent || exhausted) {
              await transitionDeletionRequest(client, row.id, {
                status: 'abandoned',
                attempts: nextAttempts,
                last_error: errorMessage,
              })
              Sentry.captureException(err, {
                extra: {
                  class: permanent ? 'permanent' : 'transient_exhausted',
                  request_id: row.id,
                  business_id: row.business_id,
                },
              })
              summary.abandoned += 1

              console.log(
                JSON.stringify({
                  kind: 'deletion.row.processed',
                  request_id: row.id,
                  business_id: row.business_id,
                  outcome: 'abandoned',
                  attempts: nextAttempts,
                  vault_secrets_deleted: 0,
                  billing_events_redacted: 0,
                  auth_user_deleted: false,
                }),
              )
            } else {
              const backoffMinutes = computeBackoff(nextAttempts)
              await transitionDeletionRequest(client, row.id, {
                status: 'failed',
                attempts: nextAttempts,
                next_attempt_at: formatISO(addMinutes(new Date(), backoffMinutes)),
                last_error: errorMessage,
              })
              summary.retried += 1

              console.log(
                JSON.stringify({
                  kind: 'deletion.row.processed',
                  request_id: row.id,
                  business_id: row.business_id,
                  outcome: 'retried',
                  attempts: nextAttempts,
                  vault_secrets_deleted: 0,
                  billing_events_redacted: 0,
                  auth_user_deleted: false,
                }),
              )
            }
          }
        }
      },
      {
        schedule: { type: 'crontab', value: '0 3 * * *' },
        checkinMargin: 5,
        maxRuntime: 50,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
      },
    )
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: 'process-deletions' } })
  }

  summary.durationMs = Date.now() - startedAt

  console.log(
    JSON.stringify({
      kind: 'deletion.tick.end',
      triggeredBy: opts.triggeredBy,
      ...summary,
    }),
  )

  return summary
}
