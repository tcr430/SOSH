'use client'

import { useTranslations } from 'next-intl'
import type { MemorySource } from '@/lib/db/types'

// ADR 0030 §9.2 (Session 36 L2.10) — where a memory row came from, as a small plain-text label wherever a memory row is shown.
//
// The value is the row's OWN `source` column, handed in by the caller; this module has no table name, no id and no way to infer a source, so a label
// can never be guessed client-side (§9.2: "It is never inferred client-side"). 'outcome' is a performance_memory source and is not part of the
// MemorySource union, so it is added here; any value outside the six renders nothing at all rather than a wrong label.
//
// Plain text in the muted foreground token — never a badge, never colour alone (the words carry the meaning). It is display-only: no control, no
// edit or retire affordance (§9.4).

export type ProvenanceSource = MemorySource | 'outcome'

// Exhaustive by type: a seventh MemorySource value fails tsc here until it has a label key. The keys are literal so the i18n key scan can see them.
const PROVENANCE_KEY: Record<ProvenanceSource, string> = {
  manual: 'provenance.manual',
  distilled: 'provenance.distilled',
  import: 'provenance.import',
  interview: 'provenance.interview',
  outcome: 'provenance.outcome',
  dismissal: 'provenance.dismissal',
}

export const PROVENANCE_SOURCES = Object.keys(PROVENANCE_KEY) as ProvenanceSource[]

export function isProvenanceSource(value: string): value is ProvenanceSource {
  return Object.prototype.hasOwnProperty.call(PROVENANCE_KEY, value)
}

/** The label as a string, for the one place an element cannot go (a native <option>). Null for a value outside the six. */
export function useProvenanceLabel(): (source: string) => string | null {
  const t = useTranslations('memory')
  return (source) => (isProvenanceSource(source) ? t(PROVENANCE_KEY[source] as never) : null)
}

export function ProvenanceLabel({ source, id, className }: { source: string; id?: string; className?: string }) {
  const label = useProvenanceLabel()(source)
  if (label === null) return null
  return (
    <span id={id} data-provenance={source} className={className ? `text-xs text-muted-foreground ${className}` : 'text-xs text-muted-foreground'}>
      {label}
    </span>
  )
}
