export type EmailKind =
  | 'trial-warning-t3'
  | 'trial-warning-t1'
  | 'welcome-to-plan'
  | 'payment-failed-courtesy'
  | 'first-post-published'
  | 'team-invite'

export type EmailLocale = 'en' | 'pt' | 'es'

// Minimal translator signature covering all template usage patterns.
// Compatible with next-intl's getTranslations() server return type.
export type TranslatorFn = (key: string, values?: Record<string, string | number>) => string

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text: string
  replyTo: string
  idempotencyKey: string
  tags?: Record<string, string>
}

export interface SendEmailResult {
  providerMessageId: string
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<SendEmailResult>
}
