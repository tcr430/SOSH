import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import {
  getBusinessById,
  getBusinessByOwner,
  createBusiness,
  updateBusiness,
  softDeleteBusiness,
  findBusinessByStripeCustomerId,
  updateBillingFromSubscription,
  clearBillingOnCancellation,
  setStripeCustomerId,
  incrementBusinessPublishedCount,
} from './businesses'
import type { BusinessRow, BusinessInsert } from './types'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
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
  onboarding_completed: false,
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

describe('getBusinessById', () => {
  it('returns a business when found', async () => {
    const { client } = createMockClient(mockBusiness)
    const result = await getBusinessById(client, 'biz-1')
    expect(result).toEqual(mockBusiness)
    expect(client.from).toHaveBeenCalledWith('businesses')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getBusinessById(client, 'biz-1')).rejects.toThrow('DB error')
  })

  it('throws when data is null', async () => {
    const { client } = createMockClient(null, null)
    await expect(getBusinessById(client, 'missing')).rejects.toThrow()
  })
})

describe('getBusinessByOwner', () => {
  it('returns a business when found', async () => {
    const { client } = createMockClient(mockBusiness)
    const result = await getBusinessByOwner(client, 'user-1')
    expect(result).toEqual(mockBusiness)
    expect(client.from).toHaveBeenCalledWith('businesses')
  })

  it('returns null when not found', async () => {
    const { client } = createMockClient(null, null)
    const result = await getBusinessByOwner(client, 'user-missing')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getBusinessByOwner(client, 'user-1')).rejects.toThrow('DB error')
  })
})

describe('createBusiness', () => {
  const insertData: BusinessInsert = {
    name: 'Acme',
    owner_id: 'user-1',
  }

  it('returns the created business', async () => {
    const { client } = createMockClient(mockBusiness)
    const result = await createBusiness(client, insertData)
    expect(result).toEqual(mockBusiness)
    expect(client.from).toHaveBeenCalledWith('businesses')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Insert error' })
    await expect(createBusiness(client, insertData)).rejects.toThrow('Insert error')
  })
})

describe('updateBusiness', () => {
  it('returns the updated business', async () => {
    const { client } = createMockClient(mockBusiness)
    const result = await updateBusiness(client, 'biz-1', { name: 'Acme Updated' })
    expect(result).toEqual(mockBusiness)
    expect(client.from).toHaveBeenCalledWith('businesses')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(updateBusiness(client, 'biz-1', { name: 'X' })).rejects.toThrow('Update error')
  })
})

describe('softDeleteBusiness', () => {
  it('resolves without error on success', async () => {
    const { client } = createMockClient(null, null)
    await expect(softDeleteBusiness(client, 'biz-1')).resolves.toBeUndefined()
    expect(client.from).toHaveBeenCalledWith('businesses')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Delete error' })
    await expect(softDeleteBusiness(client, 'biz-1')).rejects.toThrow('Delete error')
  })
})

const mockBusinessWithCustomer: BusinessRow = {
  ...mockBusiness,
  stripe_customer_id: 'cus_test_001',
  stripe_subscription_id: 'sub_test_001',
  plan: 'plus',
}

describe('findBusinessByStripeCustomerId', () => {
  it('returns a business when found', async () => {
    const { client } = createMockClient(mockBusinessWithCustomer)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await findBusinessByStripeCustomerId('cus_test_001')
    expect(result).toEqual(mockBusinessWithCustomer)
    expect(client.from).toHaveBeenCalledWith('businesses')
  })

  it('returns null when not found', async () => {
    const { client } = createMockClient(null, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await findBusinessByStripeCustomerId('cus_missing')
    expect(result).toBeNull()
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(findBusinessByStripeCustomerId('cus_test_001')).rejects.toThrow('DB error')
  })
})

describe('updateBillingFromSubscription', () => {
  it('returns updated business on match', async () => {
    const { client } = createMockClient(mockBusinessWithCustomer)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await updateBillingFromSubscription({
      stripeCustomerId: 'cus_test_001',
      stripeSubscriptionId: 'sub_test_001',
      plan: 'plus',
    })
    expect(result).toEqual(mockBusinessWithCustomer)
    expect(client.from).toHaveBeenCalledWith('businesses')
  })

  it('returns null when no business matches the customer ID', async () => {
    const { client } = createMockClient(null, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await updateBillingFromSubscription({
      stripeCustomerId: 'cus_missing',
      stripeSubscriptionId: 'sub_test_001',
      plan: 'plus',
    })
    expect(result).toBeNull()
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(
      updateBillingFromSubscription({ stripeCustomerId: 'cus_test_001', stripeSubscriptionId: 'sub_test_001', plan: 'plus' })
    ).rejects.toThrow('Update error')
  })
})

describe('clearBillingOnCancellation', () => {
  it('returns updated business with plan=trial and no subscription', async () => {
    const downgraded: BusinessRow = { ...mockBusinessWithCustomer, plan: 'trial', stripe_subscription_id: null }
    const { client } = createMockClient(downgraded)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await clearBillingOnCancellation({ stripeCustomerId: 'cus_test_001' })
    expect(result).toEqual(downgraded)
    expect(client.from).toHaveBeenCalledWith('businesses')
  })

  it('returns null when no business matches', async () => {
    const { client } = createMockClient(null, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await clearBillingOnCancellation({ stripeCustomerId: 'cus_missing' })
    expect(result).toBeNull()
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(clearBillingOnCancellation({ stripeCustomerId: 'cus_test_001' })).rejects.toThrow('Update error')
  })
})

describe('setStripeCustomerId', () => {
  it('resolves when customer ID is set for the first time', async () => {
    const { client } = createMockClient(mockBusinessWithCustomer)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(
      setStripeCustomerId({ businessId: 'biz-1', stripeCustomerId: 'cus_test_001' })
    ).resolves.toBeUndefined()
  })

  it('resolves (idempotent) when same customer ID is re-set', async () => {
    const { client } = createMockClient(mockBusinessWithCustomer)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(
      setStripeCustomerId({ businessId: 'biz-1', stripeCustomerId: 'cus_test_001' })
    ).resolves.toBeUndefined()
  })

  it('silently no-ops when business is not found / already deleted', async () => {
    const { client, builder } = createMockClient(null, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    // UPDATE matched 0 rows, SELECT also returns null (business gone)
    vi.mocked(builder.maybeSingle as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    await expect(
      setStripeCustomerId({ businessId: 'biz-gone', stripeCustomerId: 'cus_test_001' })
    ).resolves.toBeUndefined()
  })

  it('throws when a DIFFERENT stripe_customer_id is already set (double-write canary)', async () => {
    const { client, builder } = createMockClient(null, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    // UPDATE matched 0 rows (WHERE condition excluded this row)
    // SELECT reveals the business exists with a different customer ID
    vi.mocked(builder.maybeSingle as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { stripe_customer_id: 'cus_existing_other' }, error: null })
    await expect(
      setStripeCustomerId({ businessId: 'biz-1', stripeCustomerId: 'cus_new' })
    ).rejects.toThrow()
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(
      setStripeCustomerId({ businessId: 'biz-1', stripeCustomerId: 'cus_test_001' })
    ).rejects.toThrow('Update error')
  })
})

describe('incrementBusinessPublishedCount', () => {
  it('returns 1 on the 0→1 transition (first post)', async () => {
    const { client } = createMockClient(1, null)
    const result = await incrementBusinessPublishedCount(client, 'biz-1')
    expect(result).toBe(1)
    expect(client.rpc).toHaveBeenCalledWith('increment_business_published_count', {
      p_business_id: 'biz-1',
    })
  })

  it('returns 2 on the 1→2 transition (second post)', async () => {
    const { client } = createMockClient(2, null)
    const result = await incrementBusinessPublishedCount(client, 'biz-1')
    expect(result).toBe(2)
  })

  it('throws on RPC error', async () => {
    const { client } = createMockClient(null, { message: 'RPC error' })
    await expect(incrementBusinessPublishedCount(client, 'biz-1')).rejects.toThrow('RPC error')
  })
})
