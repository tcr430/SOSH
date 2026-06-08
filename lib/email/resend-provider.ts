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

function mapResendError(err: ResendErrorLike): EmailProviderError {
  const status = err.statusCode ?? 0
  let code: EmailProviderErrorCode
  if (status === 429) {
    code = 'provider_rate_limit'
  } else if (status >= 500) {
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
      const { data, error } = await this.client.emails.send(
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

      if (error) {
        throw mapResendError(error as ResendErrorLike)
      }

      if (!data?.id) {
        throw new EmailProviderError('unknown', 'Resend returned no id')
      }

      return { providerMessageId: data.id }
    } catch (err) {
      if (err instanceof EmailProviderError) throw err
      throw mapNetworkError(err)
    }
  }
}
