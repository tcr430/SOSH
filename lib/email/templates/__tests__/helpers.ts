import type { TranslatorFn } from '../../types'
import enEmail from '../../../../i18n/en/email.json'
import ptEmail from '../../../../i18n/pt/email.json'
import esEmail from '../../../../i18n/es/email.json'
import enInvite from '../../../../i18n/en/invite.json'
import ptInvite from '../../../../i18n/pt/invite.json'
import esInvite from '../../../../i18n/es/invite.json'

const DICTS: Record<string, Record<string, unknown>> = {
  en: { ...enEmail, ...enInvite } as Record<string, unknown>,
  pt: { ...ptEmail, ...ptInvite } as Record<string, unknown>,
  es: { ...esEmail, ...esInvite } as Record<string, unknown>,
}

export function makeTranslator(locale: 'en' | 'pt' | 'es'): TranslatorFn {
  const dict = DICTS[locale]
  return (key: string, values?: Record<string, string | number>): string => {
    const parts = key.split('.')
    let value: unknown = dict
    for (const part of parts) {
      value = (value as Record<string, unknown>)?.[part]
    }
    let result = typeof value === 'string' ? value : key
    if (values) {
      for (const [k, v] of Object.entries(values)) {
        result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
    }
    return result
  }
}

export const LOCALES = ['en', 'pt', 'es'] as const
export type TestLocale = (typeof LOCALES)[number]
