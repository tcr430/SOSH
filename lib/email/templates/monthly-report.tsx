import { z } from 'zod'
import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, emailCtaStyle } from './_layout'
import type { EmailLocale, TranslatorFn } from '../types'

// ADR 0031 §5.4 — the monthly report email: a header, the report's own summary sentences, and a link. NO attachment and
// no figure of its own: every sentence in `summaryLines` was rendered by lib/reports/deliver.ts from the stored payload's
// closed templates, so the email can never say what the report does not.

export const MonthlyReportPropsSchema = z.object({
  businessName: z.string().min(1).max(200),
  /** The month in the business language, e.g. "September 2026". */
  periodLabel: z.string().min(1).max(40),
  summaryLines: z.array(z.string().min(1).max(400)).max(16),
  reportUrl: z.string().url(),
})
export type MonthlyReportProps = z.infer<typeof MonthlyReportPropsSchema>

/** A header-injection guard: a CR, LF or line separator inside an interpolated value would split the subject line. */
// Every C0 control and DEL, plus NEL, LS and PS: anything a header or a log line could treat as a break (security review, finding 6).
const LINE_BREAKS = new RegExp('[\\x00-\\x1f\\x7f' + String.fromCharCode(0x85, 0x2028, 0x2029) + ']+', 'g')

export function oneLine(value: string): string {
  return value.replace(LINE_BREAKS, ' ').replace(/\s{2,}/g, ' ').trim()
}

export function monthlyReportSubject(t: TranslatorFn, props?: MonthlyReportProps): string {
  return oneLine(t('monthly_report.subject', { month: oneLine(props?.periodLabel ?? '') }))
}

export function MonthlyReportEmail(props: MonthlyReportProps & { locale: EmailLocale; t: TranslatorFn }) {
  const { locale, t, businessName, periodLabel, summaryLines, reportUrl } = props
  const values = { businessName: oneLine(businessName), month: oneLine(periodLabel) }
  return (
    <EmailLayout locale={locale} preheader={t('monthly_report.preheader', values)}>
      <Heading style={{ fontSize: '24px', fontWeight: '600', lineHeight: '1.3', margin: '0 0 16px 0' }}>
        {t('monthly_report.heading', values)}
      </Heading>
      <Text style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 12px 0' }}>{t('monthly_report.lead', values)}</Text>
      {summaryLines.map((line, i) => (
        <Text key={i} style={{ fontSize: '16px', lineHeight: '1.6', margin: '0 0 8px 0' }}>
          {line}
        </Text>
      ))}
      <Text style={{ fontSize: '14px', lineHeight: '1.6', margin: '16px 0 28px 0' }}>{t('monthly_report.supporting')}</Text>
      <Section style={{ margin: '0 0 0 0' }}>
        <Button href={reportUrl} style={emailCtaStyle}>
          {t('monthly_report.cta')}
        </Button>
      </Section>
    </EmailLayout>
  )
}
