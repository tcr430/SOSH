import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as businessesModule from '@/lib/db/businesses'
import * as stripeClientModule from '@/lib/stripe/client'
import * as serviceModule from '@/lib/supabase/service'
import { createCheckoutSession, createBillingPortalSession } from './checkout'
import type { BusinessRow } from '@/lib/db/types'

vi.mock('@/lib/stripe/client', () => ({ getStripeClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({
  getBusinessById: vi.fn(),
  setStripeCustomerId: vi.fn(),
}))
vi.mock('@/lib/stripe/products', () => ({
  PLAN_TO_PRICE_ID: { plus: 'price_plus_test', pro: 'price_pro_test' },
}))
vi.mock('@/lib/config', () => ({
  config: {
    public: { APP_URL: 'http://localhost:3000', SUPABASE_URL: 'https://test.supabase.co' },
    server: { STRIPE_SECRET_KEY: 'sk_test_placeholder' },
  },
}))

const mockBusiness: BusinessRow = {
  id: 'biz-1',
  name: 'Acme',
  website: null,
  industry: null,
  description: null,
  logo_url: null,
  owner_id: 'user-1',
  plan: 'trial',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  language: 'en',
  timezone: 'UTC',
  onboarding_completed: true,
  deleted_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

const mockStripe = {
  customers: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
  billingPortal: { sessions: { create: vi.fn() } },
}

const mockGetUserById = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(stripeClientModule.getStripeClient).mockReturnValue(mockStripe as never)
  vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue({
    auth: { admin: { getUserById: mockGetUserById } },
  } as unknown as SupabaseClient)
  mockGetUserById.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'owner@example.com' } },
    error: null,
  })
  vi.mocked(businessesModule.getBusinessById).mockResolvedValue(mockBusiness)
  vi.mocked(businessesModule.setStripeCustomerId).mockResolvedValue(undefined)
  mockStripe.customers.create.mockResolvedValue({ id: 'cus_new_001' })
  mockStripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/test' })
  mockStripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/test' })
})

describe('createCheckoutSession', () => {
  it('creates a Stripe customer when stripe_customer_id is null and persists it', async () => {
    await createCheckoutSession({ businessId: 'biz-1', plan: 'plus', successPath: '/en/billing/success', cancelPath: '/en/billing' })
    expect(mockStripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'owner@example.com', metadata: { business_id: 'biz-1' } }),
    )
    expect(businessesModule.setStripeCustomerId).toHaveBeenCalledWith({
      businessId: 'biz-1',
      stripeCustomerId: 'cus_new_001',
    })
  })

  it('reuses existing stripe_customer_id and skips customer creation', async () => {
    vi.mocked(businessesModule.getBusinessById).mockResolvedValue({
      ...mockBusiness,
      stripe_customer_id: 'cus_existing',
    })
    await createCheckoutSession({ businessId: 'biz-1', plan: 'plus', successPath: '/en/billing/success', cancelPath: '/en/billing' })
    expect(mockStripe.customers.create).not.toHaveBeenCalled()
    expect(businessesModule.setStripeCustomerId).not.toHaveBeenCalled()
  })

  it('passes the correct price ID for the requested plan', async () => {
    await createCheckoutSession({ businessId: 'biz-1', plan: 'plus', successPath: '/en/billing/success', cancelPath: '/en/billing' })
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ line_items: [{ price: 'price_plus_test', quantity: 1 }] }),
    )

    vi.mocked(businessesModule.getBusinessById).mockResolvedValue({ ...mockBusiness, stripe_customer_id: 'cus_existing' })
    await createCheckoutSession({ businessId: 'biz-1', plan: 'pro', successPath: '/en/billing/success', cancelPath: '/en/billing' })
    expect(mockStripe.checkout.sessions.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ line_items: [{ price: 'price_pro_test', quantity: 1 }] }),
    )
  })

  it('sets client_reference_id and subscription metadata to the business id', async () => {
    await createCheckoutSession({ businessId: 'biz-1', plan: 'plus', successPath: '/en/billing/success', cancelPath: '/en/billing' })
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        client_reference_id: 'biz-1',
        subscription_data: expect.objectContaining({
          metadata: expect.objectContaining({ business_id: 'biz-1' }),
        }),
      }),
    )
  })

  it('returns the session URL', async () => {
    const result = await createCheckoutSession({ businessId: 'biz-1', plan: 'plus', successPath: '/en/billing/success', cancelPath: '/en/billing' })
    expect(result).toEqual({ url: 'https://checkout.stripe.com/test' })
  })

  it('throws when Stripe returns a null session URL', async () => {
    mockStripe.checkout.sessions.create.mockResolvedValue({ url: null })
    await expect(
      createCheckoutSession({ businessId: 'biz-1', plan: 'plus', successPath: '/en/billing/success', cancelPath: '/en/billing' }),
    ).rejects.toThrow()
  })
})

describe('createBillingPortalSession', () => {
  it('returns the portal URL for a business with a customer ID', async () => {
    vi.mocked(businessesModule.getBusinessById).mockResolvedValue({
      ...mockBusiness,
      stripe_customer_id: 'cus_existing',
    })
    const result = await createBillingPortalSession({ businessId: 'biz-1', returnPath: '/en/billing' })
    expect(result).toEqual({ url: 'https://billing.stripe.com/test' })
    expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
    )
  })

  it('throws when stripe_customer_id is null', async () => {
    await expect(
      createBillingPortalSession({ businessId: 'biz-1', returnPath: '/en/billing' }),
    ).rejects.toThrow()
  })
})
