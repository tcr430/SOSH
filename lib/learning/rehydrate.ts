// ADR 0018 §5.3, [type-5] — the SECOND choke point. classify.ts's partitioned
// return protects a value from the moment it is constructed to the moment
// it is persisted; the instant a signal is written to
// post_edit_signals.signals (jsonb) and read back by a future promotion job,
// its TypeScript type is whatever the read function declares — plain JSON
// has no runtime memory of `_class`/`kind` being disjoint literals. This
// mirrors wrapEvidenceForPrompt() as "the single shared choke point"
// (lib/ai/wrap-evidence.ts:114-131): every reader of persisted signal rows
// MUST route through rehydrateSignals() rather than casting a raw jsonb
// value directly. Without a guard here, nothing else in §5.3 reaches the
// promotion path — a corrupted or hand-edited row could otherwise smuggle a
// 'correction'-in-a-'preference'-suit value past the type layer entirely.

import { z } from 'zod'
import type { Platform } from '@/lib/db/types'
import type { ClassifyResult, PreferenceKind, CorrectionKind, InconclusiveKind } from '@/lib/learning/classify'

// typescript-reviewer (C2.5 pass) flagged the four literal-tuple vocabularies
// below as hand-duplicated against their source-of-truth unions with nothing
// enforcing they stay in sync — exactly the kind of silent drift this file's
// own "second choke point" is supposed to guard against. These Assert<Equals<>>
// lines (compile-time only, zero runtime cost, mirroring lib/db/types.test.ts's
// convention) make that drift a `tsc` failure instead of a 2am corrupted-row
// surprise: if a future PR adds a Platform/Kind member here without touching
// the corresponding array below, or vice versa, one of these four lines stops
// compiling.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

const PLATFORM_VALUES = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads'] as const
type _PlatformExhaustive = Assert<Equals<(typeof PLATFORM_VALUES)[number], Platform>>

const PREFERENCE_KIND_VALUES = [
  'avoid_word_removed',
  'length_delta',
  'hashtag_delta',
  'cta_added',
  'cta_removed',
  'thread_shortened',
  'thread_lengthened',
  'link_moved',
  'numbering_stripped',
] as const
type _PreferenceKindExhaustive = Assert<Equals<(typeof PREFERENCE_KIND_VALUES)[number], PreferenceKind>>

const CORRECTION_KIND_VALUES = ['unsourced_claim_removed'] as const
type _CorrectionKindExhaustive = Assert<Equals<(typeof CORRECTION_KIND_VALUES)[number], CorrectionKind>>

const INCONCLUSIVE_KIND_VALUES = ['evidence_cited_claim_removed', 'avoid_word_added'] as const
type _InconclusiveKindExhaustive = Assert<Equals<(typeof INCONCLUSIVE_KIND_VALUES)[number], InconclusiveKind>>

const SignalDetailSchema = z.record(z.string(), z.unknown())

const PreferenceSignalSchema = z.object({
  _class: z.literal('preference'),
  kind: z.enum(PREFERENCE_KIND_VALUES),
  postId: z.string(),
  platform: z.enum(PLATFORM_VALUES),
  detail: SignalDetailSchema,
})

const CorrectionSignalSchema = z.object({
  _class: z.literal('correction'),
  kind: z.enum(CORRECTION_KIND_VALUES),
  postId: z.string(),
  platform: z.enum(PLATFORM_VALUES),
  detail: SignalDetailSchema,
})

const InconclusiveSignalSchema = z.object({
  _class: z.literal('inconclusive'),
  kind: z.enum(INCONCLUSIVE_KIND_VALUES),
  postId: z.string(),
  platform: z.enum(PLATFORM_VALUES),
  detail: SignalDetailSchema,
})

const ClassifyResultSchema = z.object({
  preferences: z.array(PreferenceSignalSchema),
  corrections: z.array(CorrectionSignalSchema),
  inconclusive: z.array(InconclusiveSignalSchema),
})

// Throws (ZodError) on any row whose `_class` doesn't match its own `kind`
// vocabulary, or whose shape has drifted (extra/missing/mistyped fields) —
// callers must not catch-and-ignore this the way a normal validation error
// might be handled; a rejection here means the persisted row itself is
// corrupt, not that the caller's input was malformed.
export function rehydrateSignals(raw: unknown): ClassifyResult {
  return ClassifyResultSchema.parse(raw)
}
