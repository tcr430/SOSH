import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import {
  getBusinessById,
  getBusinessByOwner,
  createBusiness,
  updateBusiness,
  softDeleteBusiness,
} from './businesses'
import type { BusinessRow, BusinessInsert } from './types'

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
