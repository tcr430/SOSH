import { describe, it, expect } from 'vitest'
import type { Prompt } from './types'
import { brandVoiceInferencePrompt } from './brand-voice-inference'
import { briefAssemblyPrompt } from './brief'
import { learningSummarizerPrompt } from './learning-summarizer'
import { postGenerationPrompt } from './post-generation'
import { postRegenerationPrompt } from './post-regeneration'
import { rubricPrompt } from './rubric'
import { studioSuggestionPrompt } from './studio-suggestion'
import { createNativeGenerationPrompt } from './formats/native-generation-prompt'

// ADR 0024 §3.2 (Session 31, H2.1) — the version-bump rule (ADR C-4,
// extended to sampling by ADR 0024 §3.1/L-2), made EXECUTABLE rather than
// remembered. lib/ai/prompts/formats/platform-map.frozen-table.test.ts is
// the precedent: not a snapshot file — a snapshot rots and gets -u'd back to
// green without anyone reading what changed. Every cell here is a literal,
// hand-written expectation.
//
// The table has EXACTLY TEN rows — one per prompt id, not one per file
// (ADR §2.4, §15 MAJOR-2). formats/policy.ts and formats/schemas.ts export
// validators and Zod schemas, not Prompt objects — they have no
// id/version/modelKey and get no row. native-generation-single/-thread/
// -carousel get THREE rows, because their version and model are already
// declared per family even though temperature (from H2.2 onward) is
// declared once inside the factory.
//
// The scan enumerates prompts by WALKING the exported Prompt objects plus
// the factory's three families (collectPrompts below) rather than iterating
// the frozen table's own keys — so a new prompt or a new family with NO ROW
// fails the "every live prompt has a matching row" assertion, and an
// existing prompt whose modelKey/temperature/thinking/maxTokens changed
// without its version being bumped fails the per-id value assertion. Both
// failure modes were demonstrated to redden against a temporary violation,
// then reverted, before this file was committed (H2.1 verification note,
// docs/build-guide/session-31.md).

type FrozenRow = {
  version: number
  modelKey: string
  temperature: number | undefined
  thinking: number | undefined
  maxTokens: number | undefined
}

// H2.2 (ADR 0024 §2.4, §3.3/§3.3a) declares the first real values:
// temperature 1.0 on the three native-generation families (version 2), and
// thinking 4000 + maxTokens 12_000 on brief-assembly (version 2). Every
// other row stays "no sampling property set", at version 1.
const FROZEN_TABLE: Record<string, FrozenRow> = {
  'brand-voice-inference': {
    version: 1,
    modelKey: 'OPUS_4_7',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
  },
  'brief-assembly': {
    version: 2,
    modelKey: 'SONNET_4_6',
    temperature: undefined,
    thinking: 4000,
    maxTokens: 12_000,
  },
  'learning-summarizer': {
    version: 1,
    modelKey: 'HAIKU_4_5',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
  },
  'post-generation': {
    version: 1,
    modelKey: 'SONNET_4_6',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
  },
  'post-regeneration': {
    version: 1,
    modelKey: 'SONNET_4_6',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
  },
  'rubric': {
    version: 1,
    modelKey: 'HAIKU_4_5',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
  },
  'studio-suggestion': {
    version: 1,
    modelKey: 'HAIKU_4_5',
    temperature: undefined,
    thinking: undefined,
    maxTokens: 12288,
  },
  'native-generation-single': {
    version: 2,
    modelKey: 'SONNET_4_6',
    temperature: 1.0,
    thinking: undefined,
    maxTokens: undefined,
  },
  'native-generation-thread': {
    version: 2,
    modelKey: 'SONNET_4_6',
    temperature: 1.0,
    thinking: undefined,
    maxTokens: undefined,
  },
  'native-generation-carousel': {
    version: 2,
    modelKey: 'SONNET_4_6',
    temperature: 1.0,
    thinking: undefined,
    maxTokens: undefined,
  },
}

function collectPrompts(): Array<Prompt<unknown, unknown>> {
  return [
    brandVoiceInferencePrompt,
    briefAssemblyPrompt,
    learningSummarizerPrompt,
    postGenerationPrompt,
    postRegenerationPrompt,
    rubricPrompt,
    studioSuggestionPrompt,
    createNativeGenerationPrompt('single'),
    createNativeGenerationPrompt('thread'),
    createNativeGenerationPrompt('carousel'),
  ] as Array<Prompt<unknown, unknown>>
}

describe('prompt-properties frozen table (QUAL-SAMPLING-VERSIONED)', () => {
  const prompts = collectPrompts()

  it('has exactly ten live prompt ids, matching the frozen table one-for-one', () => {
    expect(prompts).toHaveLength(10)
    expect(prompts.map((p) => p.id).sort()).toEqual(Object.keys(FROZEN_TABLE).sort())
  })

  for (const prompt of prompts) {
    it(`${prompt.id}: version/modelKey/temperature/thinking/maxTokens match the frozen row for its declared version`, () => {
      const row = FROZEN_TABLE[prompt.id]
      expect(row, `no frozen-table row for prompt id "${prompt.id}" — a new prompt/family needs a new row`).toBeDefined()
      expect(prompt.version, `${prompt.id}: version drifted without a matching frozen-table update`).toBe(row.version)
      expect(prompt.modelKey).toBe(row.modelKey)
      expect(prompt.temperature).toBe(row.temperature)
      expect(prompt.thinking).toBe(row.thinking)
      expect(prompt.maxTokens).toBe(row.maxTokens)
    })
  }
})
