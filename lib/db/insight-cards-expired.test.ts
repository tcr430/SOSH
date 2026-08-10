import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { listExpiredCardsForBusiness } from './insight-cards'

// ADR 0021 §9.2 "Expired" state — not rendered in the default feed
// (listPendingCardsForBusiness already excludes it), but reachable via an
// explicit filter, per the ADR's own note that "expired" is the derived
// predicate status='pending' AND expires_at < now() (§5.5), never a stored
// status.
describe('lib/db/insight-cards.ts listExpiredCardsForBusiness (ADR 0021 §5.5/§9.2)', () => {
  it('filters business_id + status=pending + expires_at < now, ordered and bounded', async () => {
    const { client, builder } = createMockClient([], null)

    await listExpiredCardsForBusiness(client, 'biz-1', 50)

    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'pending')
    expect(builder.lt).toHaveBeenCalledWith('expires_at', expect.any(String))
    expect(builder.order).toHaveBeenCalledWith('score', { ascending: false })
    expect(builder.order).toHaveBeenCalledWith('occurred_at', { ascending: false })
    expect(builder.order).toHaveBeenCalledWith('id', { ascending: true })
    expect(builder.limit).toHaveBeenCalledWith(50)
  })

  it('defaults its bound to 50', async () => {
    const { client, builder } = createMockClient([], null)
    await listExpiredCardsForBusiness(client, 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(50)
  })
})
