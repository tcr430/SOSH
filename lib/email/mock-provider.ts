import type { EmailProvider, SendEmailInput, SendEmailResult } from './types'
import { EmailProviderError, type EmailProviderErrorCode } from './errors'

export class MockEmailProvider implements EmailProvider {
  private sends: SendEmailInput[] = []
  private nextErrorCode: EmailProviderErrorCode | null = null

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (this.nextErrorCode) {
      const code = this.nextErrorCode
      this.nextErrorCode = null
      throw new EmailProviderError(code, `Injected: ${code}`)
    }
    this.sends.push(input)
    return { providerMessageId: `mock_${input.idempotencyKey}` }
  }

  getSends(): readonly SendEmailInput[] {
    return this.sends
  }

  failNextSend(code: EmailProviderErrorCode): void {
    this.nextErrorCode = code
  }

  reset(): void {
    this.sends = []
    this.nextErrorCode = null
  }
}
