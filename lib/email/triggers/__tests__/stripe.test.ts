import { vi, describe, it, expect, beforeEach } from 'vitest'
import type Stripe from 'stripe'
import type { BusinessRow } from '@/lib/db/types'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: { server: { APP_URL: 'https://app.sosh.io' } },
}))

const mockGetBusinessById = vi.hoisted(() => vi.fn())
const mockFindBusinessByStripeCustomerId = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/businesses', () => ({
  getBusinessById: mockGetBusinessById,
  findBusinessByStripeCustomerId: mockFindBusinessByStripeCustomerId,
}))

const mockEnqueueEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/enqueue', () => ({ enqueueEmail: mockEnqueueEmail }))

import { enqueueWelcomeToPlan, enqueuePaymentFailedCourtesy } from '../stripe'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockBusiness: BusinessRow = {
  id: 'biz-1',
  name: 'Acme SaaS',
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

function makeCheckoutEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: 'biz-1',
        customer_email: 'founder@acme.example',
        customer: 'cus_test',
        subscription: 'sub_test',
        ...overrides,
      },
    },
  } as unknown as Stripe.Event
}

function makeInvoiceEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: 'evt_invoice_1',
    type: 'invoice.payment_failed',
    data: {
      object: {
        customer: 'cus_test',
        customer_email: 'founder@acme.example',
        ...overrides,
      },
    },
  } as unknown as Stripe.Event
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetBusinessById.mockResolvedValue(mockBusiness)
  mockFindBusinessByStripeCustomerId.mockResolvedValue(mockBusiness)
  mockEnqueueEmail.mockResolvedValue({ outcome: 'enqueued', row_id: 'row-1' })
})

// ─── enqueueWelcomeToPlan ─────────────────────────────────────────────────────

describe('enqueueWelcomeToPlan', () => {
  it('calls enqueueEmail with kind=welcome-to-plan and dedupe_token=event.id', async () => {
    await enqueueWelcomeToPlan(makeCheckoutEvent())
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'biz-1',
        kind: 'welcome-to-plan',
        dedupe_token: 'evt_checkout_1',
      }),
    )
  })

  it('resolves business via client_reference_id', async () => {
    await enqueueWelcomeToPlan(makeCheckoutEvent())
    expect(mockGetBusinessById).toHaveBeenCalledWith(expect.anything(), 'biz-1')
  })

  it('sets recipient from session.customer_email (lowercased)', async () => {
    await enqueueWelcomeToPlan(makeCheckoutEvent({ customer_email: 'Founder@ACME.Example' }))
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'founder@acme.example' }),
    )
  })

  it('sets locale from business.language', async () => {
    await enqueueWelcomeToPlan(makeCheckoutEvent())
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en' }),
    )
  })

  it('props include businessName and planName=Plus for plan=plus', async () => {
    await enqueueWelcomeToPlan(makeCheckoutEvent())
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({ businessName: 'Acme SaaS', planName: 'Plus' }),
      }),
    )
  })

  it('planName=Pro for plan=pro', async () => {
    mockGetBusinessById.mockResolvedValue({ ...mockBusiness, plan: 'pro' })
    await enqueueWelcomeToPlan(makeCheckoutEvent())
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ props: expect.objectContaining({ planName: 'Pro' }) }),
    )
  })

  it('dashboardUrl is APP_URL/{locale}/campaigns', async () => {
    await enqueueWelcomeToPlan(makeCheckoutEvent())
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({ dashboardUrl: 'https://app.sosh.io/en/campaigns' }),
      }),
    )
  })

  it('does not call enqueueEmail when client_reference_id is null', async () => {
    await enqueueWelcomeToPlan(makeCheckoutEvent({ client_reference_id: null }))
    expect(mockEnqueueEmail).not.toHaveBeenCalled()
  })

  it('does not call enqueueEmail when customer_email is null', async () => {
    await enqueueWelcomeToPlan(makeCheckoutEvent({ customer_email: null }))
    expect(mockEnqueueEmail).not.toHaveBeenCalled()
  })
})

// ─── enqueuePaymentFailedCourtesy ─────────────────────────────────────────────

describe('enqueuePaymentFailedCourtesy', () => {
  it('calls enqueueEmail with kind=payment-failed-courtesy and dedupe_token=event.id', async () => {
    await enqueuePaymentFailedCourtesy(makeInvoiceEvent())
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'biz-1',
        kind: 'payment-failed-courtesy',
        dedupe_token: 'evt_invoice_1',
      }),
    )
  })

  it('resolves business via stripe customer id', async () => {
    await enqueuePaymentFailedCourtesy(makeInvoiceEvent())
    expect(mockFindBusinessByStripeCustomerId).toHaveBeenCalledWith('cus_test')
  })

  it('sets recipient from invoice.customer_email (lowercased)', async () => {
    await enqueuePaymentFailedCourtesy(makeInvoiceEvent({ customer_email: 'OWNER@ACME.EXAMPLE' }))
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'owner@acme.example' }),
    )
  })

  it('billingPortalUrl is APP_URL/{locale}/billing', async () => {
    await enqueuePaymentFailedCourtesy(makeInvoiceEvent())
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({ billingPortalUrl: 'https://app.sosh.io/en/billing' }),
      }),
    )
  })

  it('does not call enqueueEmail when business not found', async () => {
    mockFindBusinessByStripeCustomerId.mockResolvedValue(null)
    await enqueuePaymentFailedCourtesy(makeInvoiceEvent())
    expect(mockEnqueueEmail).not.toHaveBeenCalled()
  })

  it('does not call enqueueEmail when customer_email is null', async () => {
    await enqueuePaymentFailedCourtesy(makeInvoiceEvent({ customer_email: null }))
    expect(mockEnqueueEmail).not.toHaveBeenCalled()
  })
})
