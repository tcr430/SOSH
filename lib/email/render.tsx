import { render } from '@react-email/render'
import { getTranslations } from 'next-intl/server'
import { TEMPLATES } from './templates'
import type { EmailKind, EmailLocale, TranslatorFn } from './types'
import { EmailProviderError } from './errors'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export async function renderTemplate(
  kind: EmailKind,
  locale: EmailLocale,
  props: Record<string, unknown>,
): Promise<RenderedEmail> {
  const entry = TEMPLATES[kind]
  const parsed = entry.propsSchema.safeParse(props)
  if (!parsed.success) {
    throw new EmailProviderError(
      'template_render_failed',
      `Props validation failed for ${kind}`,
      { issues: parsed.error.issues },
    )
  }

  let html: string
  let text: string
  let subject: string
  try {
    const rawT = await getTranslations({ locale, namespace: 'email' })
    const t = rawT as unknown as TranslatorFn
    subject = entry.subject(t, parsed.data)
    const Component = entry.Component
    const data = parsed.data as Record<string, unknown>
    html = await render(<Component {...data} locale={locale} t={t} />)
    text = await render(<Component {...data} locale={locale} t={t} />, {
      plainText: true,
    })
  } catch (err) {
    if (err instanceof EmailProviderError) throw err
    throw new EmailProviderError(
      'template_render_failed',
      `Render failed for ${kind}: ${err instanceof Error ? err.message : String(err)}`,
      { err: String(err) },
    )
  }

  return { subject, html, text }
}
