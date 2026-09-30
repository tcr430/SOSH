import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  memoryQueryHintsSchema,
  MEMORY_QUERY_HINTS_JSON_SCHEMA,
  type ModelQueryHints,
} from './query-hints'
import type { MemoryQueryContext, RetrieveScope, MemoryTask, BundleRequest } from './scoring'

// ADR 0030 §3 (Session 36 L2.7, founder ruling A-7) — SUBSTRATE-QUERY-FIELD-CONSUMED (10) and SUBSTRATE-QUERY-MODEL-FIELDS-BOUNDED (11), Tier 2.
//
// The query context is NARROWED, not widened: `objective`, `audience` and `role` had no scoring term and leave it (ADR 0024 §5.1 is amended by name).
// What a MODEL may set is exactly { platform }, owned by ONE schema here that both the planner and the triage tools import; `campaignId` and
// `confidenceFloor` are caller-only because they narrow scope, and appear in no model-facing schema.

describe('the model-facing query hints (ADR 0030 §3.2, [type-1])', () => {
  it('the Zod schema keys AND the JSON-Schema property keys equal the literal tuple ["platform"]', () => {
    expect(Object.keys(memoryQueryHintsSchema.shape)).toEqual(['platform'])
    expect(Object.keys(MEMORY_QUERY_HINTS_JSON_SCHEMA.properties)).toEqual(['platform'])
  })

  it('the JSON Schema declares no required key', () => {
    expect(MEMORY_QUERY_HINTS_JSON_SCHEMA.type).toBe('object')
    expect((MEMORY_QUERY_HINTS_JSON_SCHEMA as { required?: string[] }).required).toBeUndefined()
  })

  it.each([
    ['objective', { objective: 'grow' }],
    ['audience', { audience: 'CTOs' }],
    ['role', { role: 'customer_proof' }],
    ['businessId', { businessId: 'attacker-biz' }],
    ['campaignId (caller-only)', { campaignId: 'c-1' }],
    ['confidenceFloor (caller-only)', { confidenceFloor: 0 }],
    ['task (BundleRequest only)', { task: 'brief' }],
  ])('REJECTS %s (z.strictObject: a smuggled key is refused, never silently stripped)', (_label, input) => {
    expect(memoryQueryHintsSchema.safeParse(input).success).toBe(false)
  })

  it('accepts {} and { platform }, and returns exactly what it was given', () => {
    expect(memoryQueryHintsSchema.parse({})).toEqual({})
    expect(memoryQueryHintsSchema.parse({ platform: 'linkedin' })).toEqual({ platform: 'linkedin' })
  })

  it('a stale model call still carrying `objective` fails with an unrecognized_keys issue naming it (the tools surface this as a retryable tool error)', () => {
    const r = memoryQueryHintsSchema.safeParse({ objective: 'x', platform: 'linkedin' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0].code).toBe('unrecognized_keys')
      expect(JSON.stringify(r.error.issues[0])).toContain('objective')
    }
  })
})

describe('the types (ADR 0030 §3.2)', () => {
  it('ModelQueryHints is exactly { platform?: string }, derived from the one schema', () => {
    expectTypeOf<ModelQueryHints>().toEqualTypeOf<{ platform?: string }>()
  })

  it('RetrieveScope is exactly the caller-only pair', () => {
    expectTypeOf<RetrieveScope>().toEqualTypeOf<{ campaignId?: string; confidenceFloor?: number }>()
  })

  it('MemoryQueryContext = ModelQueryHints & RetrieveScope: objective, audience and role are GONE', () => {
    expectTypeOf<keyof MemoryQueryContext>().toEqualTypeOf<'platform' | 'campaignId' | 'confidenceFloor'>()
    // @ts-expect-error — `objective` is no longer a MemoryQueryContext field
    const noObjective: MemoryQueryContext = { objective: 'x' }
    // @ts-expect-error — `audience` is no longer a MemoryQueryContext field
    const noAudience: MemoryQueryContext = { audience: 'x' }
    // @ts-expect-error — `role` is no longer a MemoryQueryContext field
    const noRole: MemoryQueryContext = { role: 'x' }
    void [noObjective, noAudience, noRole]
  })

  it('MemoryTask is the closed union and BundleRequest carries the task only there', () => {
    expectTypeOf<MemoryTask>().toEqualTypeOf<'brief' | 'post' | 'plan' | 'triage'>()
    expectTypeOf<BundleRequest>().toEqualTypeOf<{ task: MemoryTask; hints?: ModelQueryHints; scope?: RetrieveScope }>()
  })
})

// SUBSTRATE-QUERY-FIELD-CONSUMED: a field no scoring term reads is dead weight — that already happened once with `role`. The tuple below is
// checked AGAINST the type at compile time (a new MemoryQueryContext key fails tsc until it is listed), and each listed key is then required to
// be READ by lib/memory/scoring.ts at runtime. A field added to the type but consumed nowhere fails this test.
const CONTEXT_KEYS = ['platform', 'campaignId', 'confidenceFloor'] as const
expectTypeOf<(typeof CONTEXT_KEYS)[number]>().toEqualTypeOf<keyof MemoryQueryContext>()

describe('SUBSTRATE-QUERY-FIELD-CONSUMED — every MemoryQueryContext key has a consuming scoring term', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'memory', 'scoring.ts'), 'utf8')
  // code only: comments may legitimately mention a removed field, and must not satisfy the check
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it.each(CONTEXT_KEYS)('scoring.ts READS queryContext.%s', (key) => {
    expect(code, `scoring.ts never reads queryContext.${key}`).toMatch(new RegExp(`queryContext\\.${key}\\b`))
  })

  it('and no removed field is read there any more', () => {
    for (const removed of ['objective', 'audience', 'role']) expect(code).not.toMatch(new RegExp(`queryContext\\.${removed}\\b`))
  })
})
