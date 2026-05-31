import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from '@/lib/db/__test-utils__/mock-client'
import { markCronSeen, getCronLastSeen } from './cron-health'

describe('markCronSeen', () => {
  it('upserts with cron_slug and last_seen_at on conflict', async () => {
    const { client, builder } = createMockClient(null, null)
    await markCronSeen(client, 'publish')
    expect(client.from).toHaveBeenCalledWith('cron_health')
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ cron_slug: 'publish' }),
      { onConflict: 'cron_slug' },
    )
  })

  it('accepts different slugs', async () => {
    const { client, builder } = createMockClient(null, null)
    await markCronSeen(client, 'metrics-sync')
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ cron_slug: 'metrics-sync' }),
      { onConflict: 'cron_slug' },
    )
  })
})

describe('getCronLastSeen', () => {
  it('returns null when no row exists', async () => {
    const { client } = createMockClient(null, null)
    const result = await getCronLastSeen(client, 'publish')
    expect(result).toBeNull()
  })

  it('returns last_seen_at when row exists', async () => {
    const ts = '2026-05-31T22:00:00.000Z'
    const { client } = createMockClient({ last_seen_at: ts }, null)
    const result = await getCronLastSeen(client, 'publish')
    expect(result).toBe(ts)
  })
})
