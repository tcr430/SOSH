import * as Sentry from '@sentry/nextjs'
import { addSeconds, formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { scrubString } from '@/lib/observability/sentry-scrub'
import { getEmailProvider } from '@/lib/email/registry'
import { EmailProviderError } from '@/lib/email/errors'
import { renderTemplate } from '@/lib/email/render'
import { claimEmailOutboxBatch, transitionEmailOutboxRow } from '@/lib/db/email-outbox'
import { isEmailSuppressed } from '@/lib/db/email-suppressions'

export interface EmailDrainTickSummary {
  claimed: number
  sent: number
  retried: number
  failed: number
  suppressed: number
  durationMs: number
}

const TRANSIENT_CODES = new Set<string>(['provider_rate_limit', 'provider_unavailable'])

export function computeBackoff(attempts: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds, 3600)
  }
  const base = config.server.EMAIL_RETRY_BACKOFF_SECONDS
  const exp = base * Math.pow(2, attempts - 1)
  const jitter = exp * (0.75 + Math.random() * 0.5)
  return Math.min(Math.round(jitter), 3600)
}

export async function runEmailDrainTick(opts: {
  triggeredBy: 'qstash' | 'secret'
}): Promise<EmailDrainTickSummary> {
  const startedAt = Date.now()
  const summary: EmailDrainTickSummary = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    suppressed: 0,
    durationMs: 0,
  }

  try {
    await Sentry.withMonitor(
      'drain-email-outbox',
      async () => {
        const { createServiceRoleClient } = await import('@/lib/supabase/service')
        const client = createServiceRoleClient()
        const provider = getEmailProvider()
        const batchSize = config.server.EMAIL_DRAIN_BATCH_SIZE
        const maxAttempts = config.server.EMAIL_MAX_ATTEMPTS

        const rows = await claimEmailOutboxBatch(client, batchSize)
        summary.claimed = rows.length

        for (const row of rows) {
          // D3 drain-time suppression re-check
          if (await isEmailSuppressed(client, row.recipient)) {
            await transitionEmailOutboxRow(client, row.id, { status: 'suppressed' })
            summary.suppressed += 1
            continue
          }

          // Render
          let rendered: Awaited<ReturnType<typeof renderTemplate>>
          try {
            rendered = await renderTemplate(row.kind, row.locale, row.props as Record<string, unknown>)
          } catch (err) {
            if (err instanceof EmailProviderError && err.code === 'template_render_failed') {
              await transitionEmailOutboxRow(client, row.id, {
                status: 'failed',
                last_error: scrubString(err.message),
              })
              Sentry.captureException(err, { tags: { email_kind: row.kind } })
              summary.failed += 1
              continue
            }
            throw err
          }

          // Send
          try {
            const result = await provider.send({
              to: row.recipient,
              subject: rendered.subject,
              html: rendered.html,
              text: rendered.text,
              replyTo: config.server.EMAIL_REPLY_TO,
              idempotencyKey: row.id,
              tags: { kind: row.kind, business_id: row.business_id },
            })
            await transitionEmailOutboxRow(client, row.id, {
              status: 'sent',
              provider_message_id: result.providerMessageId ?? null,
              sent_at: formatISO(new Date()),
            })
            summary.sent += 1
          } catch (err) {
            const code = err instanceof EmailProviderError ? err.code : 'unknown'
            const isTransient = TRANSIENT_CODES.has(code)
            const nextAttempts = row.attempts + 1
            const exhausted = nextAttempts >= maxAttempts

            if (isTransient && !exhausted) {
              const backoffSeconds = computeBackoff(
                nextAttempts,
                err instanceof EmailProviderError ? err.retryAfterSeconds : undefined,
              )
              await transitionEmailOutboxRow(client, row.id, {
                status: 'pending',
                attempts: nextAttempts,
                next_attempt_at: formatISO(addSeconds(new Date(), backoffSeconds)),
                last_error: scrubString((err as Error).message),
              })
              summary.retried += 1
            } else {
              await transitionEmailOutboxRow(client, row.id, {
                status: 'failed',
                attempts: nextAttempts,
                last_error: scrubString((err as Error).message),
              })
              Sentry.captureException(err, {
                tags: { email_kind: row.kind, code, exhausted },
              })
              summary.failed += 1
            }
          }
        }
      },
      {
        schedule: { type: 'crontab', value: '* * * * *' },
        checkinMargin: 2,
        maxRuntime: 1,
        failureIssueThreshold: 3,
        recoveryThreshold: 1,
      },
    )
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: 'drain-email-outbox' } })
  }

  summary.durationMs = Date.now() - startedAt

  console.log(
    JSON.stringify({
      kind: 'email.drain.tick',
      triggeredBy: opts.triggeredBy,
      ...summary,
    }),
  )

  return summary
}
