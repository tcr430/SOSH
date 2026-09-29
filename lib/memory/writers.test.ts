import { describe, it, expect } from 'vitest'
import {
  MEMORY_WRITERS,
  MEMORY_TABLES,
  SOURCES_BY_TABLE,
  RPC_INSERT_TABLES,
  WRITER_IDS,
  importConfidence,
  distilledConfidence,
} from './writers'

// ADR 0030 §2.2 / §11.2 #10 (Session 36 L2.3) — the WriterConfidence constructors are a FIRST line; the SQL ceiling CHECK
// (supabase/__tests__/substrate-schema.test.ts) is what enforces the band. A constructor must throw outside its band and
// hand back the SAME number inside it: "WITHOUT changing a single value they forward".
describe('WriterConfidence constructors (ADR 0030 §2.2)', () => {
  it('importConfidence throws at 0, below 0, above 0.60, on NaN and on Infinity', () => {
    for (const bad of [0, -0.01, -1, 0.61, 0.6000001, 1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => importConfidence(bad), String(bad)).toThrow(/importConfidence/)
    }
  })

  it('importConfidence accepts its exact ceiling and the shipped constants, and returns the SAME value', () => {
    for (const ok of [0.6, 0.5, 0.3, 0.01, 0.6 * (5 / (5 + 5))]) expect(importConfidence(ok)).toBe(ok)
  })

  it('distilledConfidence throws below 0, above 0.95, on NaN and on Infinity', () => {
    for (const bad of [-0.01, -1, 0.96, 0.9500001, 1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => distilledConfidence(bad), String(bad)).toThrow(/distilledConfidence/)
    }
  })

  it('distilledConfidence accepts its exact ceiling and the values computeConfidence produces, and returns the SAME value', () => {
    for (const ok of [0.95, 0.714, 1 / 3, 0.01]) expect(distilledConfidence(ok)).toBe(ok)
  })

  // DRIFT from the build guide, reported in the ADR 0030 Builder verification (V.7): the guide says the distilled band
  // (0, 0.95] throws at 0. But computeConfidence (lib/learning/promote.ts:31) returns 0 whenever contradictions >= observations,
  // and that 0 is forwarded to upsert_distilled_performance_pattern today. Throwing there would change an existing writer's
  // behaviour (L-2), so the distilled band is [0, 0.95]; the import band stays (0, 0.60].
  it('distilledConfidence ACCEPTS 0: computeConfidence legitimately returns it when net <= 0 (L-2)', () => {
    expect(distilledConfidence(0)).toBe(0)
  })

  it('the constructors read their ceilings from the registry, so the registry and the band cannot drift apart', () => {
    expect(() => importConfidence(MEMORY_WRITERS.import.confidenceCeiling.evidence_memory + 0.01)).toThrow()
    expect(importConfidence(MEMORY_WRITERS.import.confidenceCeiling.evidence_memory)).toBe(0.6)
    expect(distilledConfidence(MEMORY_WRITERS.distilled.confidenceCeiling.performance_memory)).toBe(0.95)
  })
})

// ADR 0030 §2.1 (Session 36 L2.1). Every expectation below is a LITERAL, deliberately not derived from
// writers.ts: a test that computes its expected value from the thing under test cannot fail. The value sets are
// ADR 0030 §2.1's table AS IT STANDS BEFORE L2.3 (audience_memory has no 'dismissal' yet).

describe('MEMORY_WRITERS (ADR 0030 §2.1)', () => {
  // AMENDED (Session 36 L2.5): the dismissal writer is registered with its RPC in this step, as ADR 0030 §2.1 and the L2.1 comment said it
  // would be. It was five sources at L2.1; it is six now, 'dismissal' last.
  it('registers exactly the six sources that exist today, in declaration order', () => {
    expect([...WRITER_IDS]).toEqual(['manual', 'distilled', 'import', 'outcome', 'interview', 'dismissal'])
  })

  it('the four tables are the four governed stores', () => {
    expect([...MEMORY_TABLES]).toEqual(['brand_memory', 'evidence_memory', 'audience_memory', 'performance_memory'])
  })

  // AMENDED (Session 36 L2.5): ADR 0030 §2.1's table AFTER L2.3's source swap — audience_memory admits 'dismissal', and the registry
  // now lists it (the L2.1 version of this case pinned the pre-swap sets).
  it("each table's source CHECK value set equals ADR 0030 §2.1's table (audience with 'dismissal')", () => {
    expect([...SOURCES_BY_TABLE.brand_memory].sort()).toEqual(['distilled', 'import', 'interview', 'manual'])
    expect([...SOURCES_BY_TABLE.evidence_memory].sort()).toEqual(['distilled', 'import', 'interview', 'manual'])
    expect([...SOURCES_BY_TABLE.audience_memory].sort()).toEqual(['dismissal', 'distilled', 'import', 'interview', 'manual'])
    expect([...SOURCES_BY_TABLE.performance_memory].sort()).toEqual(['distilled', 'import', 'manual', 'outcome'])
  })

  it("'manual' is registered as RETIRED and WRITERLESS: in the CHECKs, but owns no RPC, wrapper, caller or table", () => {
    const manual = MEMORY_WRITERS.manual
    expect(manual.rpcNames).toEqual([])
    expect(manual.wrappers).toEqual([])
    expect(manual.soleCallerModule).toBeNull()
    expect(manual.tables).toEqual([])
    expect(manual.gate).toBeNull()
    expect(manual.mayRetire).toEqual([])
    expect(manual.checkTables).toHaveLength(4)
  })

  it('confidence ceilings are the ADR 0030 §4.1 values, and outcome has none', () => {
    expect(MEMORY_WRITERS.import.confidenceCeiling).toEqual({
      evidence_memory: 0.6,
      audience_memory: 0.6,
      performance_memory: 0.6,
    })
    expect(MEMORY_WRITERS.interview.confidenceCeiling).toEqual({
      brand_memory: 0.6,
      evidence_memory: 0.6,
      audience_memory: 0.6,
    })
    expect(MEMORY_WRITERS.distilled.confidenceCeiling).toEqual({ performance_memory: 0.95 })
    expect(MEMORY_WRITERS.outcome.confidenceCeiling).toEqual({})
    expect(MEMORY_WRITERS.manual.confidenceCeiling).toEqual({})
  })

  it('every writer may retire only its own source (ADR 0030 §4.2)', () => {
    for (const id of ['distilled', 'import', 'outcome', 'interview', 'dismissal'] as const) {
      expect([...MEMORY_WRITERS[id].mayRetire]).toEqual([id])
    }
  })

  it('the closed scope sets are pinned, so a new scope value is a registry edit', () => {
    expect([...MEMORY_WRITERS.import.scopes]).toEqual(['platform'])
    expect([...MEMORY_WRITERS.interview.scopes]).toEqual(['brand'])
    expect([...MEMORY_WRITERS.distilled.scopes]).toEqual(['brand', 'platform'])
    // acknowledge_campaign_retrospective writes the campaign-scoped hypothesis row (20260919140000:376-381)
    expect([...MEMORY_WRITERS.outcome.scopes]).toEqual(['platform', 'campaign'])
  })

  it('gates: human ratification for import and interview, minimum-n for distilled and outcome', () => {
    expect(MEMORY_WRITERS.import.gate).toBe('human_ratification')
    expect(MEMORY_WRITERS.interview.gate).toBe('human_ratification')
    expect(MEMORY_WRITERS.distilled.gate).toBe('min_n')
    expect(MEMORY_WRITERS.outcome.gate).toBe('min_n')
  })

  it('the sole caller of each writer is the module ADR 0030 §1.1 names', () => {
    expect(MEMORY_WRITERS.import.soleCallerModule).toBe('lib/memory/import.ts')
    expect(MEMORY_WRITERS.interview.soleCallerModule).toBe('lib/memory/interview.ts')
    expect(MEMORY_WRITERS.outcome.soleCallerModule).toBe('lib/outcomes/orchestrator.ts')
    // promote.ts AND summarize.ts both call the distilled wrappers, so the module is the directory
    expect(MEMORY_WRITERS.distilled.soleCallerModule).toBe('lib/learning/')
  })

  it('every RPC of every writer has an insert-target entry, and no entry names an unregistered RPC', () => {
    const registered = WRITER_IDS.flatMap((id) => [...MEMORY_WRITERS[id].rpcNames]).sort()
    expect(Object.keys(RPC_INSERT_TABLES).sort()).toEqual(registered)
    expect(registered).toHaveLength(13) // 12 at L2.1 + recompute_dismissal_audience_signal (L2.5)
  })

  it('the evidence-inserting RPC set is exactly import_evidence_memory and write_interview_candidates', () => {
    const evidence = Object.entries(RPC_INSERT_TABLES)
      .filter(([, tables]) => tables.includes('evidence_memory'))
      .map(([rpc]) => rpc)
      .sort()
    expect(evidence).toEqual(['import_evidence_memory', 'write_interview_candidates'])
  })

  // AMENDED (Session 36 L2.5): this case asserted the dismissal writer was NOT registered yet ("it lands with its RPC in L2.5"). It now is.
  it('the dismissal writer is registered with EXACTLY its recompute RPC, one table, min-n gate, the 0.50 ceiling and scope brand; its wrapper lands in L2.6', () => {
    const d = MEMORY_WRITERS.dismissal
    expect(WRITER_IDS as string[]).toContain('dismissal')
    expect([...d.rpcNames]).toEqual(['recompute_dismissal_audience_signal'])
    expect([...d.tables]).toEqual(['audience_memory'])
    expect([...d.checkTables]).toEqual(['audience_memory']) // brand, evidence and performance still refuse 'dismissal'
    expect(d.gate).toBe('min_n')
    expect(d.confidenceCeiling).toEqual({ audience_memory: 0.5 })
    expect([...d.scopes]).toEqual(['brand'])
    expect([...d.mayRetire]).toEqual(['dismissal'])
    expect(d.soleCallerModule).toBe('lib/memory/dismissal.ts')
    expect([...d.wrappers]).toEqual([]) // recomputeDismissalAudienceSignal is added with the TS writer (L2.6)
  })
})
