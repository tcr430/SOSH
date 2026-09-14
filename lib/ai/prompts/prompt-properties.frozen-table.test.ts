import { describe, it, expect } from 'vitest'
import { collectPrompts } from './collect-prompts'
import { FROZEN_TABLE } from './frozen-table'

// ADR 0024 §3.2 (Session 31, H2.1), extended by §15 (Session 31-D,
// D1/MAJOR-2) — the version-bump rule (ADR C-4, extended to sampling by ADR
// 0024 §3.1/L-2), made EXECUTABLE rather than remembered.
// lib/ai/prompts/formats/platform-map.frozen-table.test.ts is the
// precedent: not a snapshot file — a snapshot rots and gets -u'd back to
// green without anyone reading what changed. Every cell in FROZEN_TABLE
// (lib/ai/prompts/frozen-table.ts) is a literal, hand-written expectation.
//
// The table has EXACTLY TEN rows — one per prompt id, not one per file
// (ADR §2.4, §15 MAJOR-2). formats/policy.ts and formats/schemas.ts export
// validators and Zod schemas, not Prompt objects — they have no
// id/version/modelKey and get no row. native-generation-single/-thread/
// -carousel get THREE rows, because their version and model are already
// declared per family even though temperature (from H2.2 onward) is
// declared once inside the factory.
//
// D1/MAJOR-2: the scan now enumerates prompts by WALKING lib/ai/prompts/**
// on disk (collectPrompts, lib/ai/prompts/collect-prompts.ts) rather than
// iterating a hand-written import list — a new prompt or a new family with
// NO ROW fails the "every live prompt has a matching row" assertion, and an
// existing prompt whose modelKey/temperature/thinking/maxTokens changed
// without its version being bumped fails the per-id value assertion. Both
// failure modes were re-demonstrated to redden (D1 mutation: an eleventh
// prompt file added with NO import-list edit anywhere), then reverted — see
// docs/reviews/session-31-reviewer.md's CORRECTION PASS (Session 31-D)
// appendix for the transcript; the H2.1 note this comment used to cite
// proved only that editing a HAND-WRITTEN list reddens the test, which is
// not the property the constraint claims.

// Top-level await: collectPrompts() walks the filesystem and dynamically
// imports each prompt module, so it must resolve BEFORE the describe block
// below can build one `it()` per prompt id — vitest's ESM test files
// support this the same way prompt-properties.frozen-table.test.ts's sibling
// (formats/platform-map.frozen-table.test.ts) does not need to, because that
// file's enumeration was already synchronous.
const prompts = await collectPrompts()

describe('prompt-properties frozen table (QUAL-SAMPLING-VERSIONED)', () => {
  it('has exactly twelve live prompt ids, matching the frozen table one-for-one', () => {
    // ADR 0025 §4.1 (Session 32 I2.11) raised the count from ten to twelve:
    // backfill-voice-synthesis and backfill-insights.
    expect(prompts).toHaveLength(12)
    expect(prompts.map((p) => p.id).sort()).toEqual(Object.keys(FROZEN_TABLE).sort())
  })

  for (const prompt of prompts) {
    it(`${prompt.id}: version/modelKey/temperature/thinking/maxTokens/useToolOutput match the frozen row for its declared version`, () => {
      const row = FROZEN_TABLE[prompt.id]
      expect(row, `no frozen-table row for prompt id "${prompt.id}" — a new prompt/family needs a new row`).toBeDefined()
      expect(prompt.version, `${prompt.id}: version drifted without a matching frozen-table update`).toBe(row.version)
      expect(prompt.modelKey).toBe(row.modelKey)
      expect(prompt.temperature).toBe(row.temperature)
      expect(prompt.thinking).toBe(row.thinking)
      expect(prompt.maxTokens).toBe(row.maxTokens)
      expect(prompt.useToolOutput, `${prompt.id}: useToolOutput drifted without a matching frozen-table update`).toBe(row.useToolOutput)
    })
  }
})
