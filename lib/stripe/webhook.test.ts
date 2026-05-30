import { vi, describe, it, expect, beforeEach } from 'vitest'
import Stripe from 'stripe'
import * as stripeClientModule from '@/lib/stripe/client'
import * as businessesModule from '@/lib/db/businesses'
import * as trialStateModule from '@/lib/db/trial-state'
import * as productsModule from '@/lib/stripe/products'
import { parseWebhookEvent, dispatchWebhookEvent, WebhookSignatureError } from './webhook'
import type { BusinessRow } from '@/lib/db/types'

vi.mock('@/lib/stripe/client', () => ({ getStripeClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({
  findBusinessByStripeCustomerId: vi.fn(),
  updateBillingFromSubscription: vi.fn(),
  clearBillingOnCancellation: vi.fn(),
}))
vi.mock('@/lib/db/trial-state', () => ({
  recordTrialCardFingerprint: vi.fn(),
}))
vi.mock('@/lib/stripe/products', () => ({
  planForPriceId: vi.fn(),
}))
vi.mock('@/lib/config', () => ({
  config: {
    public: { APP_URL: 'http://localhost:3000', SUPABASE_URL: 'https://test.supabase.co' },
    server: {
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_for_unit_tests_only',
    },
  },
}))

const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests_only'

const mockBusiness: BusinessRow = {
  id: 'biz-1',
  name: 'Acme',
  website: null,
  industry: null,
  description: null,
  logo_url: null,
  owner_id: 'user-1',
  plan: 'plus',
  stripe_customer_id: 'cus_test',
  stripe_subscription_id: 'sub_test',
  language: 'en',
  timezone: 'UTC',
  onboarding_completed: true,
  deleted_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

// Real Stripe instance for generateTestHeaderString — no actual API calls made
const realStripe = new Stripe('sk_test_placeholder_not_used_for_api_calls')

function makeSignedPayload(payload: object) {
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = realStripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: TEST_WEBHOOK_SECRET,
    timestamp,
  })
  return { body, signature }
}

const mockStripe = {
  webhooks: {
    constructEvent: vi.fn(),
  },
  subscriptions: { retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  setupIntents: { retrieve: vi.fn() },
  paymentMethods: { retrieve: vi.fn() },
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(stripeClientModule.getStripeClient).mockReturnValue(mockStripe as unknown as Stripe)
})

// ─── parseWebhookEvent ────────────────────────────────────────────────────────

describe('parseWebhookEvent', () => {
  it('parses a valid signed payload', () => {
    const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } } as unknown as Stripe.Event
    mockStripe.webhooks.constructEvent.mockReturnValue(event)
    const result = parseWebhookEvent('{}', 't=1,v1=abc')
    expect(result).toBe(event)
  })

  it('throws WebhookSignatureError when signature header is null', () => {
    expect(() => parseWebhookEvent('{}', null)).toThrow(WebhookSignatureError)
  })

  it('throws WebhookSignatureError when signature header is empty string', () => {
    expect(() => parseWebhookEvent('{}', '')).toThrow(WebhookSignatureError)
  })

  it('throws WebhookSignatureError when Stripe SDK throws StripeSignatureVerificationError', () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Stripe.errors.StripeSignatureVerificationError('t=1,v1=bad', '{}')
    })
    expect(() => parseWebhookEvent('{}', 't=1,v1=bad')).toThrow(WebhookSignatureError)
  })

  it('does not leak signature detail in the error message', () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Stripe.errors.StripeSignatureVerificationError('t=1,v1=bad', '{}')
    })
    const err = (() => {
      try { parseWebhookEvent('{}', 't=1,v1=bad') }
      catch (e) { return e }
    })()
    // Our WebhookSignatureError must not expose Stripe internals like key IDs or timing
    expect((err as Error).message).toBe('Webhook signature verification failed')
  })
})

// ─── dispatchWebhookEvent ─────────────────────────────────────────────────────

describe('dispatchWebhookEvent — checkout.session.completed', () => {
  function makeSessionEvent(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Event {
    return {
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'biz-1',
          customer: 'cus_test',
          subscription: 'sub_test',
          payment_intent: null,
          setup_intent: null,
          ...overrides,
        } as unknown as Stripe.Checkout.Session,
      },
    } as unknown as Stripe.Event
  }

  beforeEach(() => {
    vi.mocked(productsModule.planForPriceId).mockReturnValue('plus')
    vi.mocked(businessesModule.updateBillingFromSubscription).mockResolvedValue(mockBusiness)
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_test',
      items: { data: [{ price: { id: 'price_plus_test' } }] },
    })
  })

  it('returns applied when all fields are present', async () => {
    const result = await dispatchWebhookEvent(makeSessionEvent())
    expect(result).toEqual({ outcome: 'applied', businessId: 'biz-1' })
    expect(businessesModule.updateBillingFromSubscription).toHaveBeenCalledWith({
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      plan: 'plus',
    })
  })

  it('returns ignored_no_business when client_reference_id is null and customer lookup fails', async () => {
    vi.mocked(businessesModule.findBusinessByStripeCustomerId).mockResolvedValue(null)
    const result = await dispatchWebhookEvent(makeSessionEvent({ client_reference_id: null }))
    expect(result.outcome).toBe('ignored_no_business')
  })

  it('returns ignored_unknown_price when price ID is not mapped', async () => {
    vi.mocked(productsModule.planForPriceId).mockReturnValue(null)
    const result = await dispatchWebhookEvent(makeSessionEvent())
    expect(result.outcome).toBe('ignored_unknown_price')
  })

  it('returns ignored_no_business when updateBillingFromSubscription returns null', async () => {
    vi.mocked(businessesModule.updateBillingFromSubscription).mockResolvedValue(null)
    const result = await dispatchWebhookEvent(makeSessionEvent())
    expect(result.outcome).toBe('ignored_no_business')
  })

  it('returns applied outcome even when fingerprint capture fails', async () => {
    vi.mocked(trialStateModule.recordTrialCardFingerprint).mockRejectedValue(new Error('vault failure'))
    mockStripe.paymentIntents.retrieve.mockResolvedValue({ payment_method: 'pm_test' })
    mockStripe.paymentMethods.retrieve.mockResolvedValue({ card: { fingerprint: 'fp_test' } })
    const result = await dispatchWebhookEvent(makeSessionEvent({ payment_intent: 'pi_test' }))
    expect(result).toEqual({ outcome: 'applied', businessId: 'biz-1' })
    expect(trialStateModule.recordTrialCardFingerprint).toHaveBeenCalled()
  })
})

describe('dispatchWebhookEvent — customer.subscription.updated', () => {
  function makeSubEvent(status: string, priceId = 'price_plus_test'): Stripe.Event {
    return {
      id: 'evt_sub_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test',
          customer: 'cus_test',
          status,
          items: { data: [{ price: { id: priceId } }] },
        } as unknown as Stripe.Subscription,
      },
    } as unknown as Stripe.Event
  }

  it('calls clearBillingOnCancellation for canceled status', async () => {
    vi.mocked(businessesModule.clearBillingOnCancellation).mockResolvedValue(mockBusiness)
    const result = await dispatchWebhookEvent(makeSubEvent('canceled'))
    expect(result.outcome).toBe('applied')
    expect(businessesModule.clearBillingOnCancellation).toHaveBeenCalledWith({ stripeCustomerId: 'cus_test' })
  })

  it('calls clearBillingOnCancellation for unpaid status', async () => {
    vi.mocked(businessesModule.clearBillingOnCancellation).mockResolvedValue(mockBusiness)
    const result = await dispatchWebhookEvent(makeSubEvent('unpaid'))
    expect(result.outcome).toBe('applied')
  })

  it('calls updateBillingFromSubscription for active status', async () => {
    vi.mocked(productsModule.planForPriceId).mockReturnValue('plus')
    vi.mocked(businessesModule.updateBillingFromSubscription).mockResolvedValue(mockBusiness)
    const result = await dispatchWebhookEvent(makeSubEvent('active'))
    expect(result.outcome).toBe('applied')
    expect(businessesModule.updateBillingFromSubscription).toHaveBeenCalled()
  })

  it('returns ignored_unknown_price when price is not mapped on active', async () => {
    vi.mocked(productsModule.planForPriceId).mockReturnValue(null)
    const result = await dispatchWebhookEvent(makeSubEvent('active'))
    expect(result.outcome).toBe('ignored_unknown_price')
  })
})

describe('dispatchWebhookEvent — customer.subscription.deleted', () => {
  it('calls clearBillingOnCancellation and returns applied', async () => {
    vi.mocked(businessesModule.clearBillingOnCancellation).mockResolvedValue(mockBusiness)
    const event: Stripe.Event = {
      id: 'evt_del_1',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_test',
          customer: 'cus_test',
        } as unknown as Stripe.Subscription,
      },
    } as unknown as Stripe.Event
    const result = await dispatchWebhookEvent(event)
    expect(result.outcome).toBe('applied')
    expect(businessesModule.clearBillingOnCancellation).toHaveBeenCalledWith({ stripeCustomerId: 'cus_test' })
  })

  it('returns ignored_no_business when business not found', async () => {
    vi.mocked(businessesModule.clearBillingOnCancellation).mockResolvedValue(null)
    const event: Stripe.Event = {
      id: 'evt_del_2',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_test', customer: 'cus_unknown' } as unknown as Stripe.Subscription },
    } as unknown as Stripe.Event
    const result = await dispatchWebhookEvent(event)
    expect(result.outcome).toBe('ignored_no_business')
  })
})

describe('dispatchWebhookEvent — invoice.payment_failed', () => {
  it('returns applied without any DB mutation', async () => {
    const event: Stripe.Event = {
      id: 'evt_inv_1',
      type: 'invoice.payment_failed',
      data: { object: {} as unknown as Stripe.Invoice },
    } as unknown as Stripe.Event
    const result = await dispatchWebhookEvent(event)
    expect(result).toEqual({ outcome: 'applied', businessId: null })
    expect(businessesModule.updateBillingFromSubscription).not.toHaveBeenCalled()
    expect(businessesModule.clearBillingOnCancellation).not.toHaveBeenCalled()
  })
})

describe('dispatchWebhookEvent — unknown event type', () => {
  it('returns applied with null businessId', async () => {
    const event: Stripe.Event = {
      id: 'evt_unknown_1',
      type: 'payment_intent.created',
      data: { object: {} as unknown as Stripe.PaymentIntent },
    } as unknown as Stripe.Event
    const result = await dispatchWebhookEvent(event)
    expect(result).toEqual({ outcome: 'applied', businessId: null })
  })
})

// Suppress unused import warning — makeSignedPayload is available for future integration tests
void makeSignedPayload
