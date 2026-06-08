import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { isEmailSuppressed, upsertSuppression } from './email-suppressions'

describe('isEmailSuppressed', () => {
  it('returns false when no suppression row found', async () => {
    const { client } = createMockClient(null, null)
    const result = await isEmailSuppressed(client, 'user@example.com')
    expect(result).toBe(false)
    expect(client.from).toHaveBeenCalledWith('email_suppressions')
  })

  it('returns true when a suppression row exists', async () => {
    const { client } = createMockClient({ email: 'user@example.com' }, null)
    const result = await isEmailSuppressed(client, 'user@example.com')
    expect(result).toBe(true)
  })

  it('lowercases the email before lookup', async () => {
    const { client, builder } = createMockClient(null, null)
    await isEmailSuppressed(client, 'User@Example.COM')
    expect(builder.eq).toHaveBeenCalledWith('email', 'user@example.com')
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { code: '42501', message: 'permission denied' })
    await expect(isEmailSuppressed(client, 'user@example.com')).rejects.toThrow('permission denied')
  })
})

describe('upsertSuppression', () => {
  it('returns { inserted: true } on first insert', async () => {
    const { client } = createMockClient(null, null)
    const result = await upsertSuppression(client, {
      email: 'user@example.com',
      reason: 'bounce',
    })
    expect(result).toEqual({ inserted: true })
    expect(client.from).toHaveBeenCalledWith('email_suppressions')
  })

  it('returns { inserted: false } on duplicate (23505)', async () => {
    const { client } = createMockClient(null, { code: '23505', message: 'duplicate key' })
    const result = await upsertSuppression(client, {
      email: 'user@example.com',
      reason: 'complaint',
    })
    expect(result).toEqual({ inserted: false })
  })

  it('lowercases email before insert', async () => {
    const { client, builder } = createMockClient(null, null)
    await upsertSuppression(client, { email: 'User@Example.COM', reason: 'manual' })
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@example.com' }),
    )
  })

  it('stores null when source_event_id is omitted', async () => {
    const { client, builder } = createMockClient(null, null)
    await upsertSuppression(client, { email: 'a@b.com', reason: 'bounce' })
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ source_event_id: null }),
    )
  })

  it('throws on non-duplicate DB errors', async () => {
    const { client } = createMockClient(null, { code: '42501', message: 'permission denied' })
    await expect(
      upsertSuppression(client, { email: 'user@example.com', reason: 'bounce' }),
    ).rejects.toThrow('permission denied')
  })
})
