import type { Hunk } from '@/lib/studio/diff'

// ADR 0019 §5.7/§6.1 — consumes D2.3's serialized Hunk[] and renders REACT
// NODES only. NEVER dangerouslySetInnerHTML, NEVER an HTML-returning diff
// API (diff-match-patch's diff_prettyHtml() is banned by name in the ADR
// for exactly this reason — it would carry the model's full revision as an
// HTML string). Insert/delete are distinguished by MORE than colour: a
// leading +/− glyph plus strikethrough-on-delete, so the distinction
// survives for a colour-blind or high-contrast-mode reader.

interface DiffViewProps {
  hunks: readonly Hunk[]
  originalLabel: string
  revisedLabel: string
}

function renderSide(hunks: readonly Hunk[], side: 'original' | 'revised') {
  const skipKind = side === 'original' ? 'insert' : 'delete'
  const visible = hunks.filter((h) => h.kind !== skipKind)
  return visible.map((hunk, i) => {
    const key = `${side}-${i}-${hunk.originalStart}-${hunk.revisedStart}`
    if (hunk.kind === 'equal') {
      return <span key={key}>{hunk.value}</span>
    }
    if (hunk.kind === 'delete') {
      // Only ever shown on the 'original' side (filtered out of 'revised' above).
      return (
        <span key={key} className="bg-destructive/10 text-destructive line-through decoration-2">
          <span aria-hidden="true">− </span>
          {hunk.value}
        </span>
      )
    }
    // insert — only ever shown on the 'revised' side.
    return (
      <span key={key} className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 underline decoration-2">
        <span aria-hidden="true">+ </span>
        {hunk.value}
      </span>
    )
  })
}

export function DiffView({ hunks, originalLabel, revisedLabel }: DiffViewProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{originalLabel}</h3>
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap">
          {renderSide(hunks, 'original')}
        </div>
      </div>
      <div>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{revisedLabel}</h3>
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap">
          {renderSide(hunks, 'revised')}
        </div>
      </div>
    </div>
  )
}
