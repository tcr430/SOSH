import { vi, describe, it, expect, beforeEach } from 'vitest'
import Stripe from 'stripe'
import * as webhookModule from '@/lib/stripe/webhook'
import * as billingEventsModule from '@/lib/db/billing-events'
import * as businessesModule from '@/lib/db/businesses'
import type { BusinessRow } from '@/lib/db/types'

const mockAfter = vi.hoisted(() => vi.fn())
vi.mock('next/server', () => ({ after: mockAfter }))

const mockEnqueueWelcomeToPlan = vi.hoisted(() => vi.fn())
const mockEnqueuePaymentFailedCourtesy = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/triggers/stripe', () => ({
  enqueueWelcomeToPlan: mockEnqueueWelcomeToPlan,
  enqueuePaymentFailedCourtesy: mockEnqueuePaymentFailedCourtesy,
}))

vi.mock('@/lib/stripe/webhook', () => ({
  parseWebhookEvent: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  WebhookSignatureError: class WebhookSignatureError extends Error {
    constructor() { super('Webhook signature verification failed') }
  },
}))
vi.mock('@/lib/db/billing-events', () => ({
  recordBillingEvent: vi.fn(),
  updateBillingEventOutcome: vi.fn(),
}))
vi.mock('@/lib/db/businesses', () => ({
  findBusinessByStripeCustomerId: vi.fn(),
  updateBillingFromSubscription: vi.fn(),
  clearBillingOnCancellation: vi.fn(),
  setStripeCustomerId: vi.fn(),
  getBusinessById: vi.fn(),
}))
vi.mock('@/lib/stripe/client', () => ({ getStripeClient: vi.fn() }))
vi.mock('@/lib/config', () => ({
  config: {
    public: { APP_URL: 'http://localhost:3000', SUPABASE_URL: 'https://test.supabase.co' },
    server: {
      STRIPE_SECRET_KEY: 'sk_test_placeholder',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_for_unit_tests_only',
    },
  },
}))
vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Map([['stripe-signature', 't=1,v1=valid']]))),
}))

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
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

function makeCheckoutEvent(id = 'evt_1'): Stripe.Event {
  return {
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: 'biz-1',
        customer: 'cus_test',
        subscription: 'sub_test',
        payment_intent: null,
        setup_intent: null,
      } as unknown as Stripe.Checkout.Session,
    },
  } as unknown as Stripe.Event
}

function makeRequest(body = '{}', signature = 't=1,v1=valid'): Request {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body,
  })
}

// Must import after mocks are set up
async function getRoute() {
  const { POST } = await import('./route')
  return POST
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(billingEventsModule.recordBillingEvent).mockResolvedValue({ duplicate: false })
  vi.mocked(billingEventsModule.updateBillingEventOutcome).mockResolvedValue(undefined)
  vi.mocked(webhookModule.dispatchWebhookEvent).mockResolvedValue({ outcome: 'applied', businessId: 'biz-1' })
  vi.mocked(businessesModule.updateBillingFromSubscription).mockResolvedValue(mockBusiness)
})

describe('POST /api/stripe/webhook', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const { WebhookSignatureError } = await import('@/lib/stripe/webhook')
    vi.mocked(webhookModule.parseWebhookEvent).mockImplementation(() => { throw new WebhookSignatureError() })
    const POST = await getRoute()
    const res = await POST(makeRequest('{}', ''))
    expect(res.status).toBe(400)
    expect(billingEventsModule.recordBillingEvent).not.toHaveBeenCalled()
  })

  it('returns 400 when signature is invalid (tampered body)', async () => {
    const { WebhookSignatureError } = await import('@/lib/stripe/webhook')
    vi.mocked(webhookModule.parseWebhookEvent).mockImplementation(() => { throw new WebhookSignatureError() })
    const POST = await getRoute()
    const res = await POST(makeRequest('{"tampered":true}'))
    expect(res.status).toBe(400)
  })

  it('returns 200 and flips plan on valid checkout.session.completed', async () => {
    const event = makeCheckoutEvent()
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(webhookModule.dispatchWebhookEvent).mockResolvedValue({ outcome: 'applied', businessId: 'biz-1' })
    const POST = await getRoute()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(billingEventsModule.recordBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'evt_1', type: 'checkout.session.completed' }),
    )
    expect(billingEventsModule.updateBillingEventOutcome).toHaveBeenCalledWith('evt_1', 'applied')
  })

  it('returns 200 immediately on duplicate event ID without calling dispatch', async () => {
    const event = makeCheckoutEvent('evt_dup')
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(billingEventsModule.recordBillingEvent).mockResolvedValue({ duplicate: true })
    const POST = await getRoute()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(webhookModule.dispatchWebhookEvent).not.toHaveBeenCalled()
    expect(billingEventsModule.updateBillingEventOutcome).not.toHaveBeenCalled()
  })

  it('records ignored_unknown_price outcome when price ID is unknown', async () => {
    const event = makeCheckoutEvent('evt_unknown_price')
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(webhookModule.dispatchWebhookEvent).mockResolvedValue({ outcome: 'ignored_unknown_price', businessId: 'biz-1' })
    const POST = await getRoute()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(billingEventsModule.updateBillingEventOutcome).toHaveBeenCalledWith('evt_unknown_price', 'ignored_unknown_price')
    expect(businessesModule.updateBillingFromSubscription).not.toHaveBeenCalled()
  })

  it('reverts plan to trial on customer.subscription.deleted', async () => {
    const event: Stripe.Event = {
      id: 'evt_del',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_test', customer: 'cus_test' } as unknown as Stripe.Subscription },
    } as unknown as Stripe.Event
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(webhookModule.dispatchWebhookEvent).mockResolvedValue({ outcome: 'applied', businessId: 'biz-1' })
    const POST = await getRoute()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(billingEventsModule.updateBillingEventOutcome).toHaveBeenCalledWith('evt_del', 'applied')
  })

  it('returns 500 on dispatch error and marks billing_events row as error', async () => {
    const event = makeCheckoutEvent('evt_fail')
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(webhookModule.dispatchWebhookEvent).mockRejectedValue(new Error('Supabase exploded'))
    const POST = await getRoute()
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(billingEventsModule.updateBillingEventOutcome).toHaveBeenCalledWith('evt_fail', 'error')
  })

  it('processes idempotently on retry after 500 — duplicate path short-circuits', async () => {
    const event = makeCheckoutEvent('evt_retry')
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    // Second call: recordBillingEvent returns duplicate
    vi.mocked(billingEventsModule.recordBillingEvent).mockResolvedValueOnce({ duplicate: true })
    const POST = await getRoute()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(webhookModule.dispatchWebhookEvent).not.toHaveBeenCalled()
  })

  it('after() registered once on checkout.session.completed with outcome=applied', async () => {
    const event = makeCheckoutEvent()
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(webhookModule.dispatchWebhookEvent).mockResolvedValue({ outcome: 'applied', businessId: 'biz-1' })
    const POST = await getRoute()
    await POST(makeRequest())
    expect(mockAfter).toHaveBeenCalledTimes(1)
  })

  it('after() callback invokes enqueueWelcomeToPlan with the event', async () => {
    const event = makeCheckoutEvent()
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(webhookModule.dispatchWebhookEvent).mockResolvedValue({ outcome: 'applied', businessId: 'biz-1' })
    mockEnqueueWelcomeToPlan.mockResolvedValue(undefined)
    const POST = await getRoute()
    await POST(makeRequest())
    const [afterCallback] = mockAfter.mock.calls[0] as [() => Promise<void>]
    await afterCallback()
    expect(mockEnqueueWelcomeToPlan).toHaveBeenCalledWith(event)
  })

  it('after() registered once on invoice.payment_failed with outcome=applied', async () => {
    const event: Stripe.Event = {
      id: 'evt_inv',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_test', customer_email: 'user@example.com' } as unknown as Stripe.Invoice },
    } as unknown as Stripe.Event
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(webhookModule.dispatchWebhookEvent).mockResolvedValue({ outcome: 'applied', businessId: 'biz-1' })
    const POST = await getRoute()
    await POST(makeRequest())
    expect(mockAfter).toHaveBeenCalledTimes(1)
  })

  it('after() callback invokes enqueuePaymentFailedCourtesy with the event', async () => {
    const event: Stripe.Event = {
      id: 'evt_inv2',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_test', customer_email: 'user@example.com' } as unknown as Stripe.Invoice },
    } as unknown as Stripe.Event
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(webhookModule.dispatchWebhookEvent).mockResolvedValue({ outcome: 'applied', businessId: 'biz-1' })
    mockEnqueuePaymentFailedCourtesy.mockResolvedValue(undefined)
    const POST = await getRoute()
    await POST(makeRequest())
    const [afterCallback] = mockAfter.mock.calls[0] as [() => Promise<void>]
    await afterCallback()
    expect(mockEnqueuePaymentFailedCourtesy).toHaveBeenCalledWith(event)
  })

  it('after() not called when outcome is not applied', async () => {
    const event = makeCheckoutEvent()
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(webhookModule.dispatchWebhookEvent).mockResolvedValue({ outcome: 'ignored_unknown_price', businessId: 'biz-1' })
    const POST = await getRoute()
    await POST(makeRequest())
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('after() not called on duplicate event', async () => {
    const event = makeCheckoutEvent()
    vi.mocked(webhookModule.parseWebhookEvent).mockReturnValue(event)
    vi.mocked(billingEventsModule.recordBillingEvent).mockResolvedValue({ duplicate: true })
    const POST = await getRoute()
    await POST(makeRequest())
    expect(mockAfter).not.toHaveBeenCalled()
  })
})
