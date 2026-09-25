import enAgency from '@/i18n/en/agency.json'
import ptAgency from '@/i18n/pt/agency.json'
import esAgency from '@/i18n/es/agency.json'
import enOutcome from '@/i18n/en/outcome.json'
import ptOutcome from '@/i18n/pt/outcome.json'
import esOutcome from '@/i18n/es/outcome.json'

// TEST-ONLY (ADR 0027 K2.10). A translator over the REAL message files, so a component test asserts against the
// strings a user in that locale would actually read — not against key names. That is what lets "the vocabulary is
// 'cited', never 'verified' or 'supported', in en/pt/es" be tested as RENDERED text rather than only as JSON leaves.
//
// It implements just enough ICU for these namespaces: `{name}` substitution and one-level
// `{n, plural, one {…} other {…}}` (with `#`). Not a general formatter.

export type Locale = 'en' | 'pt' | 'es'

const MESSAGES: Record<Locale, Record<string, unknown>> = {
  en: { agency: enAgency, outcome: enOutcome },
  pt: { agency: ptAgency, outcome: ptOutcome },
  es: { agency: esAgency, outcome: esOutcome },
}

function lookup(root: unknown, path: string[]): string | undefined {
  let node: unknown = root
  for (const part of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

function format(message: string, vars: Record<string, string | number> | undefined): string {
  let out = message.replace(/\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g, (_m, name: string, one: string, other: string) => {
    const n = Number(vars?.[name] ?? 0)
    return (n === 1 ? one : other).replace(/#/g, String(n))
  })
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}

export function makeTranslator(locale: Locale, namespace: string) {
  const [root, ...rest] = namespace.split('.')
  return (key: string, vars?: Record<string, string | number>): string => {
    const text = lookup(MESSAGES[locale][root], [...rest, ...key.split('.')])
    // A missing key returns a loud marker so a test fails on it instead of silently rendering the key.
    return text === undefined ? `⟦missing ${namespace}.${key}⟧` : format(text, vars)
  }
}

export const LOCALES: readonly Locale[] = ['en', 'pt', 'es']

// The words that must NEVER appear on these surfaces (ADR 0027 §4.6/§8.3): verification proves PROVENANCE, not
// support. Per locale, matching the stems of "verified" and "supported" (and, in pt/es, "validated").
export const FORBIDDEN_VOCABULARY: Record<Locale, RegExp> = {
  en: /verif|support/i,
  pt: /verific|comprov|suport|valid/i,
  es: /verific|comprob|respald|soport|valid/i,
}
