import { CALIBRATION_BANK, applyAnswer } from './calibration'
import { vectorToVoiceFields } from './translate'
import type { VoiceAxes } from '@/lib/validation/voice'
import type { CalibrationOption } from './calibration'

export interface VoiceEditorState {
  readonly axes: VoiceAxes
  readonly step: number
  readonly keywords: ReadonlyArray<string>
  readonly avoidWords: ReadonlyArray<string>
}

export interface VoiceEditorSavePayload {
  readonly voiceAxes: VoiceAxes
  readonly tone: string[]
  readonly keywords: string[]
  readonly avoidWords: string[]
}

export function initialEditorState(
  axes: VoiceAxes,
  keywords: string[] = [],
  avoidWords: string[] = [],
): VoiceEditorState {
  return { axes, step: 0, keywords, avoidWords }
}

export function isLocked(state: VoiceEditorState): boolean {
  return state.step < CALIBRATION_BANK.length
}

export function isFinalStep(state: VoiceEditorState): boolean {
  return state.step >= CALIBRATION_BANK.length
}

export function currentQuestion(state: VoiceEditorState): (typeof CALIBRATION_BANK)[number] | null {
  if (isFinalStep(state)) return null
  return CALIBRATION_BANK[state.step] ?? null
}

export function answerQuestion(state: VoiceEditorState, option: CalibrationOption): VoiceEditorState {
  if (isFinalStep(state)) return state
  return { ...state, axes: applyAnswer(state.axes, option), step: state.step + 1 }
}

export function manuallyAdjustAxes(state: VoiceEditorState, axes: VoiceAxes): VoiceEditorState {
  if (isLocked(state)) throw new Error('Cannot adjust axes before final step')
  return { ...state, axes }
}

export function setKeywords(state: VoiceEditorState, keywords: string[]): VoiceEditorState {
  return { ...state, keywords }
}

export function setAvoidWords(state: VoiceEditorState, avoidWords: string[]): VoiceEditorState {
  return { ...state, avoidWords }
}

export function buildSavePayload(state: VoiceEditorState): VoiceEditorSavePayload {
  const { tone } = vectorToVoiceFields(state.axes)
  return {
    voiceAxes: state.axes,
    tone,
    keywords: [...state.keywords],
    avoidWords: [...state.avoidWords],
  }
}
