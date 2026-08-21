import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { hasTriageFailedCandidates } from './signal-candidates'

// ADR 0021 §9.2 "Triage failed" state — the opportunities feed must render an
// operator-visible banner rather than silently omitting failed candidates
// (L-3's fail-closed-must-be-visible point). This is a bounded existence
// check only (limit 1), never a full list — the feed needs a boolean, not
// the rows.
describe('lib/db/signal-candidates.ts hasTriageFailedCandidates (ADR 0021 §9.2)', () => {
  it('queries business_id + status=triage_failed, bounded to 1 row', async () => {
    const { client, builder } = createMockClient([], null)

    await hasTriageFailedCandidates(client, 'biz-1')

    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'triage_failed')
    expect(builder.limit).toHaveBeenCalledWith(1)
  })

  it('returns true when at least one triage_failed candidate exists', async () => {
    const { client } = createMockClient([{ id: 'cand-1' }], null)
    const result = await hasTriageFailedCandidates(client, 'biz-1')
    expect(result).toBe(true)
  })

  it('returns false when no triage_failed candidates exist', async () => {
    const { client } = createMockClient([], null)
    const result = await hasTriageFailedCandidates(client, 'biz-1')
    expect(result).toBe(false)
  })

  it('throws on a query error rather than returning a false negative', async () => {
    const { client } = createMockClient(null, { message: 'boom' })
    await expect(hasTriageFailedCandidates(client, 'biz-1')).rejects.toThrow()
  })
})
