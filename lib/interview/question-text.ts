import en from '@/i18n/en/interview.json'
import pt from '@/i18n/pt/interview.json'
import es from '@/i18n/es/interview.json'

// ADR 0029 §3.5 — the authored question text, resolved OUTSIDE a request. The extraction runs from a Server Action or a
// worker with no next-intl request scope, so it reads the same three locale files the UI does, statically. The text is
// AUTHORED (this repo), not customer text, so it goes into a prompt as instruction context and needs no [DATA] wrapper.

const QUESTIONS: Readonly<Record<'en' | 'pt' | 'es', Readonly<Record<string, string>>>> = {
  en: en.questions,
  pt: pt.questions,
  es: es.questions,
}

/** The question in the given language (falling back to English for any other language code), or undefined for an unknown key. */
export function questionTextFor(questionKey: string, language: string): string | undefined {
  const locale = language === 'pt' || language === 'es' ? language : 'en'
  return QUESTIONS[locale][questionKey]
}
