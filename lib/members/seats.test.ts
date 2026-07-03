import { describe, it, expect } from 'vitest'
import { evaluateSeatState } from './seats'

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
