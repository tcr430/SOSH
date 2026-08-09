import { describe, it, expect } from 'vitest'
import { validateCardDraft, ANGLE_MAX_CHARS, RATIONALE_MAX_CHARS, type CardDraftForValidation } from './validate'

function baseDraft(overrides: Partial<CardDraftForValidation> = {}): CardDraftForValidation {
  return {
    observation: 'v2.4 shipped SSO support.',
    whyItMatters: 'SSO is a top-3 objection in enterprise deals.',
    audience: 'Enterprise IT buyers evaluating SSO.',
    angleOptions: [{ angle: 'SSO is now available', rationale: 'Removes a common enterprise blocker.' }],
    suggestedObjective: null,
    allowedUrl: 'https://github.com/acme/repo/releases/v2.4',
    ...overrides,
  }
}

describe('validateCardDraft (ADR 0021 §4.5, Session 28 E5.7)', () => {
  it('accepts a clean draft', () => {
    expect(validateCardDraft(baseDraft())).toEqual({ ok: true })
  })

  // ─── The five rejections ───────────────────────────────────────────────

  it('rejects a hashtag', () => {
    const result = validateCardDraft(baseDraft({ observation: 'Big news #SSO is here.' }))
    expect(result).toEqual({ ok: false, reason: 'hashtag', field: 'observation' })
  })

  it('rejects an @-mention', () => {
    const result = validateCardDraft(baseDraft({ whyItMatters: 'Thanks @acme-eng for shipping this.' }))
    expect(result).toEqual({ ok: false, reason: 'mention', field: 'whyItMatters' })
  })

  it('rejects an emoji', () => {
    const result = validateCardDraft(baseDraft({ audience: 'Enterprise buyers 🚀 love this.' }))
    expect(result).toEqual({ ok: false, reason: 'emoji', field: 'audience' })
  })

  it("rejects a URL other than the signal's own html_url", () => {
    const result = validateCardDraft(
      baseDraft({ observation: 'See https://attacker.example/phish for details.' }),
    )
    expect(result).toEqual({ ok: false, reason: 'disallowed_url', field: 'observation' })
  })

  it("accepts the signal's own html_url when it appears verbatim", () => {
    const result = validateCardDraft(
      baseDraft({ observation: 'Released at https://github.com/acme/repo/releases/v2.4 today.' }),
    )
    expect(result).toEqual({ ok: true })
  })

  it('rejects a newline inside an angle', () => {
    const result = validateCardDraft(
      baseDraft({ angleOptions: [{ angle: 'SSO is now\navailable', rationale: 'Fine.' }] }),
    )
    expect(result).toEqual({ ok: false, reason: 'newline_in_angle', field: 'angleOptions[0].angle' })
  })

  // ─── Shape ──────────────────────────────────────────────────────────────

  it('rejects more than 3 angle options', () => {
    const angleOptions = Array.from({ length: 4 }, (_, i) => ({ angle: `Angle ${i}`, rationale: 'x' }))
    const result = validateCardDraft(baseDraft({ angleOptions }))
    expect(result).toEqual({ ok: false, reason: 'shape', field: 'angleOptions' })
  })

  it('rejects an angle exceeding the max length', () => {
    const result = validateCardDraft(
      baseDraft({ angleOptions: [{ angle: 'x'.repeat(ANGLE_MAX_CHARS + 1), rationale: 'ok' }] }),
    )
    expect(result).toEqual({ ok: false, reason: 'shape', field: 'angleOptions[0].angle' })
  })

  it('rejects a rationale exceeding the max length', () => {
    const result = validateCardDraft(
      baseDraft({ angleOptions: [{ angle: 'ok', rationale: 'x'.repeat(RATIONALE_MAX_CHARS + 1) }] }),
    )
    expect(result).toEqual({ ok: false, reason: 'shape', field: 'angleOptions[0].angle' })
  })

  it('checks suggestedObjective too, when present', () => {
    const result = validateCardDraft(baseDraft({ suggestedObjective: 'Promote #SSO everywhere' }))
    expect(result).toEqual({ ok: false, reason: 'hashtag', field: 'suggestedObjective' })
  })
})
