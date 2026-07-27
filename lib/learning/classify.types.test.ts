/**
 * ADR 0018 §5.3 Layer 3 — compile-time regression test for
 * LEARN-CORRECTION-PREFERENCE-ENFORCED (TS half; the C2.3 migration's DB
 * trigger is the other half).
 *
 * No runtime test framework. Correctness is verified by `tsc --noEmit`,
 * mirroring lib/db/types.test.ts's convention (lines 91, 95, 116, 138-143):
 *   - Lines WITHOUT @ts-expect-error must compile.
 *   - Lines WITH @ts-expect-error must fail (otherwise tsc reports an unused
 *     suppress directive, which is also an error under strict mode).
 */

import type { ClassifyResult, VoiceDirectedWriterInput } from '@/lib/learning/classify'

// C2.6's future promotion-job voice writer does not exist yet; its parameter
// TYPE is pinned now via `VoiceDirectedWriterInput` so this assertion is
// meaningful ahead of that write path being built, and so C2.6's writer is
// obligated to accept exactly this type.

// Positive: PreferenceSignal[] is exactly what the writer expects.
const _preferencesOk: VoiceDirectedWriterInput = [] as ClassifyResult['preferences']

// Negative: CorrectionSignal[] must not be assignable.
// @ts-expect-error — CorrectionSignal[] is not assignable to VoiceDirectedWriterInput (PreferenceSignal[])
const _correctionsBad: VoiceDirectedWriterInput = [] as ClassifyResult['corrections']

// Negative: InconclusiveSignal[] must not be assignable.
// @ts-expect-error — InconclusiveSignal[] is not assignable to VoiceDirectedWriterInput (PreferenceSignal[])
const _inconclusiveBad: VoiceDirectedWriterInput = [] as ClassifyResult['inconclusive']
