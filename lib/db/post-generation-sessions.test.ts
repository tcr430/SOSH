import { describe, it, expect, vi } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { recoverStuckGenerationSessions } from './post-generation-sessions'

// ─── recoverStuckGenerationSessions ─────────────────────────────────────────

describe('recoverStuckGenerationSessions', () => {
  it('returns the count of rows flipped to failed', async () => {
    const { client, builder } = createMockClient([{ id: 'sess-1' }, { id: 'sess-2' }])
    const result = await recoverStuckGenerationSessions(client, {
      now: new Date('2026-05-25T10:00:00Z'),
      staleMinutes: 15,
    })
    expect(result).toBe(2)
    expect(client.from).toHaveBeenCalledWith('post_generation_sessions')
  })

  it('sets status=failed, error_code=timeout, and completed_at on stale rows', async () => {
    const now = new Date('2026-05-25T10:00:00Z')
    const { client, builder } = createMockClient([{ id: 'sess-1' }])
    await recoverStuckGenerationSessions(client, { now, staleMinutes: 15 })
    const updateArg = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.status).toBe('failed')
    expect(updateArg.error_code).toBe('timeout')
    expect(typeof updateArg.completed_at).toBe('string')
  })

  it('filters WHERE status=generating', async () => {
    const { client, builder } = createMockClient([])
    await recoverStuckGenerationSessions(client, {
      now: new Date('2026-05-25T10:00:00Z'),
      staleMinutes: 15,
    })
    expect(builder.eq).toHaveBeenCalledWith('status', 'generating')
  })

  it('filters WHERE started_at < cutoff (stale rows only)', async () => {
    const now = new Date('2026-05-25T10:00:00Z')
    const { client, builder } = createMockClient([])
    await recoverStuckGenerationSessions(client, { now, staleMinutes: 15 })
    expect(builder.lt).toHaveBeenCalledWith('started_at', expect.any(String))
  })

  it('returns 0 when no stale rows exist', async () => {
    const { client } = createMockClient([])
    const result = await recoverStuckGenerationSessions(client, {
      now: new Date('2026-05-25T10:00:00Z'),
      staleMinutes: 15,
    })
    expect(result).toBe(0)
  })

  it('returns 0 when data is null (no rows matched)', async () => {
    const { client } = createMockClient(null)
    const result = await recoverStuckGenerationSessions(client, {
      now: new Date('2026-05-25T10:00:00Z'),
      staleMinutes: 15,
    })
    expect(result).toBe(0)
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(
      recoverStuckGenerationSessions(client, {
        now: new Date('2026-05-25T10:00:00Z'),
        staleMinutes: 15,
      })
    ).rejects.toThrow('DB error')
  })
})
