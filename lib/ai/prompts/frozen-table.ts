// ADR 0024 §3.2 (Session 31, H2.1), extended by §15 (Session 31-D, D1/MAJOR-2)
// — the version-bump rule (ADR C-4, extended to sampling by ADR 0024
// §3.1/L-2), made EXECUTABLE rather than remembered.
// lib/ai/prompts/formats/platform-map.frozen-table.test.ts is the precedent:
// not a snapshot file — a snapshot rots and gets -u'd back to green without
// anyone reading what changed. Every cell here is a literal, hand-written
// expectation.
//
// Extracted out of prompt-properties.frozen-table.test.ts (D1/MAJOR-2) so
// BOTH prompt-properties.frozen-table.test.ts and lib/scope-scans.test.ts's
// QUAL-NO-NEW-AI-SURFACE case read the SAME table instead of one owning it
// and the other hand-counting a literal "10" — the duplicated-enumeration
// shape that produced MAJOR-2 in the first place.
//
// The table has EXACTLY TEN rows — one per prompt id, not one per file
// (ADR §2.4, §15 MAJOR-2). formats/policy.ts and formats/schemas.ts export
// validators and Zod schemas, not Prompt objects — they have no
// id/version/modelKey and get no row. native-generation-single/-thread/
// -carousel get THREE rows, because their version and model are already
// declared per family even though temperature (from H2.2 onward) is
// declared once inside the factory.

export type FrozenRow = {
  version: number
  modelKey: string
  temperature: number | undefined
  thinking: number | undefined
  maxTokens: number | undefined
  // ADR 0024 §6.1 (Session 31, H2.10) — a silent toggle changes the wire
  // contract (forces tool_choice, switches the parse path) exactly as
  // materially as a modelKey change, so it is gated the same way.
  useToolOutput: boolean | undefined
}

// H2.2 (ADR 0024 §2.4, §3.3/§3.3a) declares the first real values:
// temperature 1.0 on the three native-generation families (version 2), and
// thinking 4000 + maxTokens 12_000 on brief-assembly (version 2). Every
// other row stays "no sampling property set", at version 1.
export const FROZEN_TABLE: Record<string, FrozenRow> = {
  'brand-voice-inference': {
    version: 1,
    modelKey: 'OPUS_4_7',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: undefined,
  },
  'brief-assembly': {
    version: 3,
    modelKey: 'SONNET_4_6',
    temperature: undefined,
    thinking: 4000,
    maxTokens: 12_000,
    useToolOutput: undefined,
  },
  // ADR 0024 §6.2 (Session 31, H2.10) — the FIRST and ONLY prompt migrated
  // to tool_use structured output this session.
  'learning-summarizer': {
    version: 1,
    modelKey: 'HAIKU_4_5',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: true,
  },
  'post-generation': {
    version: 1,
    modelKey: 'SONNET_4_6',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: undefined,
  },
  'post-regeneration': {
    version: 1,
    modelKey: 'SONNET_4_6',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: undefined,
  },
  'rubric': {
    version: 1,
    modelKey: 'HAIKU_4_5',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: undefined,
  },
  'studio-suggestion': {
    version: 1,
    modelKey: 'HAIKU_4_5',
    temperature: undefined,
    thinking: undefined,
    maxTokens: 12288,
    useToolOutput: undefined,
  },
  // ADR 0026 §4.3 (Session 33, J2.4) — the three native-generation rows move 2 -> 3:
  // the system-prompt text now asks for hookType. Nothing else about them changed
  // (same model, same temperature, no thinking, no tool output).
  // ADR 0027 §4.1 (Session 34 K2.9) — the three rows move 3 -> 4 again: the system-prompt text now asks for
  // `claims` (checkable assertions + the pinned-evidence id said to support each). Same model, temperature, no
  // thinking, no tool output; AI_ORIGINAL_SCHEMA_VERSION is NOT bumped (optional field, ADR 0026 §4.3 precedent).
  'native-generation-single': {
    version: 4,
    modelKey: 'SONNET_4_6',
    temperature: 1.0,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: undefined,
  },
  'native-generation-thread': {
    version: 4,
    modelKey: 'SONNET_4_6',
    temperature: 1.0,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: undefined,
  },
  'native-generation-carousel': {
    version: 4,
    modelKey: 'SONNET_4_6',
    temperature: 1.0,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: undefined,
  },
  // ADR 0025 §4.1 (Session 32 I2.11) — the two new backfill model passes.
  // Neither trial-classified (BACKFILL-TRIAL-CAPS-UNTOUCHED, lib/ai/
  // runner.ts's isBackfillPass).
  'backfill-voice-synthesis': {
    version: 1,
    modelKey: 'SONNET_4_6',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: undefined,
  },
  'backfill-insights': {
    version: 1,
    modelKey: 'SONNET_4_6',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: undefined,
  },
  // ADR 0025 §4.1/§4.5 (Session 32 I2.12) — the third and last backfill
  // model pass, Haiku (cheap, batched).
  'backfill-evidence': {
    version: 1,
    modelKey: 'HAIKU_4_5',
    temperature: undefined,
    thinking: undefined,
    maxTokens: undefined,
    useToolOutput: undefined,
  },
}
