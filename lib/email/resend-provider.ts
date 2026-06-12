import { Resend } from 'resend'
import { config } from '@/lib/config'
import type { EmailProvider, SendEmailInput, SendEmailResult } from './types'
import { EmailProviderError, type EmailProviderErrorCode } from './errors'

type ResendErrorLike = {
  message: string
  statusCode: number | null
  name: string
}

function isResendErrorLike(val: unknown): val is ResendErrorLike {
  return (
    val !== null &&
    typeof val === 'object' &&
    'message' in val &&
    'name' in val
  )
}

function parseRetryAfterHeader(headers: Record<string, string> | null | undefined): number | undefined {
  const headerValue = Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === 'retry-after')?.[1]
  if (!headerValue) return undefined
  const asInt = Number.parseInt(headerValue, 10)
  if (Number.isFinite(asInt) && asInt > 0) return Math.min(asInt, 3600)
  const asDate = Date.parse(headerValue)
  if (!Number.isFinite(asDate)) return undefined
  const deltaSeconds = Math.round((asDate - Date.now()) / 1000)
  if (deltaSeconds <= 0) return undefined
  return Math.min(deltaSeconds, 3600)
}

function mapResendError(
  err: ResendErrorLike,
  responseHeaders?: Record<string, string> | null,
): EmailProviderError {
  const status = err.statusCode ?? 0
  if (status === 429) {
    return new EmailProviderError(
      'provider_rate_limit',
      err.message,
      { statusCode: 429, resendName: err.name },
      parseRetryAfterHeader(responseHeaders),
    )
  }
  let code: EmailProviderErrorCode
  if (status >= 500) {
    code = 'provider_unavailable'
  } else if (status === 422) {
    code = 'invalid_recipient'
  } else {
    code = 'unknown'
  }
  return new EmailProviderError(code, err.message, { statusCode: status, resendName: err.name })
}

function mapNetworkError(err: unknown): EmailProviderError {
  const message = err instanceof Error ? err.message : 'Network error'
  return new EmailProviderError('provider_unavailable', message)
}

export class ResendEmailProvider implements EmailProvider {
  private client: Resend

  constructor() {
    this.client = new Resend(config.server.RESEND_API_KEY)
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const sdkResponse = await this.client.emails.send(
        {
          from: `SŌSH <${config.server.EMAIL_FROM}>`,
          to: input.to,
          replyTo: input.replyTo,
          subject: input.subject,
          html: input.html,
          text: input.text,
          tags: input.tags
            ? Object.entries(input.tags).map(([name, value]) => ({ name, value }))
            : undefined,
        },
        { idempotencyKey: input.idempotencyKey },
      )

      if (sdkResponse.error) {
        throw mapResendError(sdkResponse.error as ResendErrorLike, sdkResponse.headers)
      }

      if (!sdkResponse.data?.id) {
        throw new EmailProviderError('unknown', 'Resend returned no id')
      }

      return { providerMessageId: sdkResponse.data.id }
    } catch (err) {
      if (err instanceof EmailProviderError) throw err
      throw mapNetworkError(err)
    }
  }
}
