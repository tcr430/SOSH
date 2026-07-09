import { describe, it, expect } from 'vitest'
import { evaluateSeatState, getSeatMeterView } from './seats'

describe('evaluateSeatState', () => {
  it('computes used/remaining/atCap/overage for a bounded plan below cap', () => {
    const state = evaluateSeatState({ plan: 'plus', activeCount: 3, pendingCount: 2 })
    expect(state).toEqual({ used: 5, max: 10, remaining: 5, atCap: false, overage: 0 })
  })

  it('atCap is true when used === max', () => {
    const state = evaluateSeatState({ plan: 'trial', activeCount: 8, pendingCount: 2 })
    expect(state.used).toBe(10)
    expect(state.atCap).toBe(true)
    expect(state.remaining).toBe(0)
    expect(state.overage).toBe(0)
  })

  it('overage is the excess when used > max (e.g. after a plan downgrade)', () => {
    const state = evaluateSeatState({ plan: 'plus', activeCount: 12, pendingCount: 3 })
    expect(state.used).toBe(15)
    expect(state.max).toBe(10)
    expect(state.atCap).toBe(true)
    expect(state.overage).toBe(5)
  })

  it('unlimited plan (max=null) never hits cap and has null remaining', () => {
    const state = evaluateSeatState({ plan: 'pro', activeCount: 500, pendingCount: 10 })
    expect(state.max).toBeNull()
    expect(state.remaining).toBeNull()
    expect(state.atCap).toBe(false)
    expect(state.overage).toBe(0)
  })

  it('agency mirrors pro (unlimited)', () => {
    const state = evaluateSeatState({ plan: 'agency', activeCount: 50, pendingCount: 0 })
    expect(state.max).toBeNull()
    expect(state.atCap).toBe(false)
  })
})

describe('getSeatMeterView (SEAT-METER-COPY, SEAT-OVERAGE-CTA-DISTINCT)', () => {
  it('Normal: bounded plan below cap → no CTA', () => {
    const view = getSeatMeterView(evaluateSeatState({ plan: 'plus', activeCount: 3, pendingCount: 2 }))
    expect(view).toEqual({
      variant: 'normal',
      messageKey: 'team.seat_meter.normal',
      ctaLabelKey: null,
      ctaHref: null,
    })
  })

  it('Unlimited: max===null → no CTA', () => {
    const view = getSeatMeterView(evaluateSeatState({ plan: 'pro', activeCount: 500, pendingCount: 10 }))
    expect(view).toEqual({
      variant: 'unlimited',
      messageKey: 'team.seat_meter.unlimited',
      ctaLabelKey: null,
      ctaHref: null,
    })
  })

  it('At cap: atCap && overage===0 → upgrade CTA to /billing', () => {
    const view = getSeatMeterView(evaluateSeatState({ plan: 'trial', activeCount: 8, pendingCount: 2 }))
    expect(view).toEqual({
      variant: 'at_cap',
      messageKey: 'team.seat_meter.at_cap',
      ctaLabelKey: 'team.seat_meter.upgrade_cta',
      ctaHref: '/billing',
    })
  })

  it('Overage-locked: overage>0 → distinct (non-upgrade) CTA to /billing', () => {
    const view = getSeatMeterView(evaluateSeatState({ plan: 'plus', activeCount: 12, pendingCount: 3 }))
    expect(view).toEqual({
      variant: 'overage_locked',
      messageKey: 'team.seat_meter.overage_locked',
      ctaLabelKey: 'team.seat_meter.overage_cta',
      ctaHref: '/billing',
    })
  })

  it('the at-cap and overage-locked CTA label keys are distinct (overage is never "upgrade")', () => {
    const atCap = getSeatMeterView(evaluateSeatState({ plan: 'trial', activeCount: 8, pendingCount: 2 }))
    const overage = getSeatMeterView(evaluateSeatState({ plan: 'plus', activeCount: 12, pendingCount: 3 }))
    expect(atCap.ctaLabelKey).not.toBe(overage.ctaLabelKey)
    expect(overage.ctaLabelKey).not.toContain('upgrade')
  })

  it('all 4 variants are reachable and mutually distinct', () => {
    const variants = new Set([
      getSeatMeterView(evaluateSeatState({ plan: 'plus', activeCount: 3, pendingCount: 2 })).variant,
      getSeatMeterView(evaluateSeatState({ plan: 'pro', activeCount: 500, pendingCount: 10 })).variant,
      getSeatMeterView(evaluateSeatState({ plan: 'trial', activeCount: 8, pendingCount: 2 })).variant,
      getSeatMeterView(evaluateSeatState({ plan: 'plus', activeCount: 12, pendingCount: 3 })).variant,
    ])
    expect(variants).toEqual(new Set(['normal', 'unlimited', 'at_cap', 'overage_locked']))
  })
})
