import type { StudioSuggestionDTO } from '@/lib/studio/verify'

// ADR 0019 §8.5 — the citation renderer. Consumes ONLY the render data the
// verifier already proved (word-as-spelled + match offset; pattern text +
// confidence + observationCount; the evidence snippet) — never a raw model
// claim string. No `dangerouslySetInnerHTML`, no interactivity of its own,
// no hooks: a pure presentational leaf.
//
// A note on the Server/Client boundary, since the ADR names it explicitly:
// §8.5's ideal is a Server Component consuming the branded
// `VerifiedMemorySource` directly, so the branded value is never
// serialized. In THIS track's actual data flow, the citable-suggestions
// call is a client-triggered Server Action (D2.8): `verifyStudioResponse`
// mints the brand and `toStudioClientDTO` converts it to this
// `StudioSuggestionDTO` shape *inside* the action, before the value ever
// reaches a component render pass — there is no live render site holding a
// raw `VerifiedMemorySource`. This component is therefore typed against the
// DTO's already-verified, already-serialized memory-arm shape, which is
// exactly the degradation §8.5 names by name: "from type-enforced to
// single-producer chokepoint (`toStudioClientDTO`, D2.7's source scan #3)
// plus executable source scan" — not a silent departure from the ADR, the
// ADR's own stated fallback. This file has no `'use client'` directive and
// uses no client-only API, so it remains a genuine Server Component; it is
// bundled into the client tree only because its parent (`SuggestionCard`)
// is itself a Client Component that imports it directly, not because it
// requires client execution.

type MemorySource = Extract<StudioSuggestionDTO, { attribution: 'memory' }>['source']

interface MemoryCitationProps {
  source: MemorySource
  labels: {
    avoidWord: (word: string) => string
    performancePattern: (confidence: number, observationCount: number) => string
    evidence: string
  }
}

export function MemoryCitation({ source, labels }: MemoryCitationProps) {
  switch (source.kind) {
    case 'avoid_word':
      return (
        <p className="text-xs text-muted-foreground">
          {labels.avoidWord(source.word)}
        </p>
      )
    case 'performance_pattern':
      return (
        <blockquote className="border-l-2 border-border pl-2 text-xs text-muted-foreground">
          <p className="italic">&ldquo;{source.pattern}&rdquo;</p>
          <p className="mt-0.5">{labels.performancePattern(source.confidence, source.observationCount)}</p>
        </blockquote>
      )
    case 'evidence':
      return (
        <blockquote className="border-l-2 border-border pl-2 text-xs text-muted-foreground">
          <p className="italic">&ldquo;{source.snippet}&rdquo;</p>
          <p className="mt-0.5">{labels.evidence}</p>
        </blockquote>
      )
  }
}
