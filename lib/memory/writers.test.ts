import { describe, it, expect } from 'vitest'
import { MEMORY_WRITERS, MEMORY_TABLES, SOURCES_BY_TABLE, RPC_INSERT_TABLES, WRITER_IDS } from './writers'

// ADR 0030 §2.1 (Session 36 L2.1). Every expectation below is a LITERAL, deliberately not derived from
// writers.ts: a test that computes its expected value from the thing under test cannot fail. The value sets are
// ADR 0030 §2.1's table AS IT STANDS BEFORE L2.3 (audience_memory has no 'dismissal' yet).

describe('MEMORY_WRITERS (ADR 0030 §2.1)', () => {
  it('registers exactly the five sources that exist today, in declaration order', () => {
    expect([...WRITER_IDS]).toEqual(['manual', 'distilled', 'import', 'outcome', 'interview'])
  })

  it('the four tables are the four governed stores', () => {
    expect([...MEMORY_TABLES]).toEqual(['brand_memory', 'evidence_memory', 'audience_memory', 'performance_memory'])
  })

  it("each table's source CHECK value set equals ADR 0030 §2.1's table before L2.3", () => {
    expect([...SOURCES_BY_TABLE.brand_memory].sort()).toEqual(['distilled', 'import', 'interview', 'manual'])
    expect([...SOURCES_BY_TABLE.evidence_memory].sort()).toEqual(['distilled', 'import', 'interview', 'manual'])
    expect([...SOURCES_BY_TABLE.audience_memory].sort()).toEqual(['distilled', 'import', 'interview', 'manual'])
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
    for (const id of ['distilled', 'import', 'outcome', 'interview'] as const) {
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
    expect(registered).toHaveLength(12)
  })

  it('the evidence-inserting RPC set is exactly import_evidence_memory and write_interview_candidates', () => {
    const evidence = Object.entries(RPC_INSERT_TABLES)
      .filter(([, tables]) => tables.includes('evidence_memory'))
      .map(([rpc]) => rpc)
      .sort()
    expect(evidence).toEqual(['import_evidence_memory', 'write_interview_candidates'])
  })

  it('the dismissal writer is NOT registered yet (it lands with its RPC in L2.5)', () => {
    expect(WRITER_IDS as string[]).not.toContain('dismissal')
    expect(SOURCES_BY_TABLE.audience_memory as readonly string[]).not.toContain('dismissal')
  })
})
