import { describe, it, expect, vi, beforeEach } from 'vitest'

const PLUS_PRICE_ID = 'price_plus_test_12345'
const PRO_PRICE_ID = 'price_pro_test_67890'

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      STRIPE_PRICE_ID_PLUS: PLUS_PRICE_ID,
      STRIPE_PRICE_ID_PRO: PRO_PRICE_ID,
    },
  },
}))

describe('planForPriceId', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns plus for the plus price ID', async () => {
    const { planForPriceId } = await import('./products')
    expect(planForPriceId(PLUS_PRICE_ID)).toBe('plus')
  })

  it('returns pro for the pro price ID', async () => {
    const { planForPriceId } = await import('./products')
    expect(planForPriceId(PRO_PRICE_ID)).toBe('pro')
  })

  it('returns null for an unknown price ID', async () => {
    const { planForPriceId } = await import('./products')
    expect(planForPriceId('price_unknown_xxxxx')).toBeNull()
  })
})
