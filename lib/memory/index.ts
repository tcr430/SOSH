// ADR 0016 §5.1 (MEM-NO-DIRECT-TABLE-ACCESS) — the single public entry
// point, mirroring lib/social/index.ts. Nothing outside lib/memory/ imports
// lib/memory/<type> directly; consumers import from here.
//
// Production consumers today: lib/ai/context.ts, which imports
// retrievePerformancePatterns (B3) and retrieveVoice (Session 23-D · D2).
//
// retrieveBrandMemory / retrieveEvidenceMemory / retrieveAudienceMemory have
// NO production consumer yet, by design: ADR 0016 §10 names ADR 0017 (Mode 2)
// as their consumer, and Track A's stated purpose is to ship the read side
// ahead of it. They are built and Tier-2 tested, not dead code awaiting
// deletion — but they are unwired, and that is a deliberate, recorded state
// rather than an oversight.

export { retrieveRelevant as retrieveBrandMemory } from './brand'
export { retrieveRelevant as retrieveEvidenceMemory } from './evidence'
export { retrieveRelevant as retrieveAudienceMemory } from './audience'
export { retrieveRelevant as retrievePerformancePatterns, type PerformancePattern } from './performance'
export { retrieveVoice, type CoreVoiceRules } from './voice'

export type { MemoryQueryContext } from './scoring'
export { BRAND_CAP, EVIDENCE_CAP, AUDIENCE_CAP, PERFORMANCE_CAP, MEMORY_SCORE_WEIGHTS } from './constants'
