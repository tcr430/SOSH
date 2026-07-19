// ADR 0016 §5.1 (MEM-NO-DIRECT-TABLE-ACCESS) — the single public entry
// point, mirroring lib/social/index.ts. Nothing outside lib/memory/ imports
// lib/memory/<type> directly; consumers (today: nothing — B3 wires
// retrievePerformancePatterns and retrieveVoice into lib/ai/context.ts)
// import from here.

export { retrieveRelevant as retrieveBrandMemory } from './brand'
export { retrieveRelevant as retrieveEvidenceMemory } from './evidence'
export { retrieveRelevant as retrieveAudienceMemory } from './audience'
export { retrieveRelevant as retrievePerformancePatterns, type PerformancePattern } from './performance'
export { retrieveVoice, type CoreVoiceRules } from './voice'

export type { MemoryQueryContext } from './scoring'
export { BRAND_CAP, EVIDENCE_CAP, AUDIENCE_CAP, PERFORMANCE_CAP, MEMORY_SCORE_WEIGHTS } from './constants'
