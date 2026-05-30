import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

export function createMockClient(data: unknown = null, error: unknown = null) {
  const result = { data, error }

  const builder: Record<string, unknown> = {
    then: (res: (v: typeof result) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej),
    catch: (rej: (e: unknown) => unknown) => Promise.resolve(result).catch(rej),
    finally: (fin: () => void) => Promise.resolve(result).finally(fin),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }

  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'in', 'is', 'lte', 'gte', 'lt', 'gt',
    'order', 'limit', 'range', 'not', 'filter', 'match', 'or',
    'returns', 'throwOnError',
  ]
  for (const m of chainMethods) {
    builder[m] = vi.fn().mockReturnValue(builder)
  }

  const client = {
    from: vi.fn().mockReturnValue(builder),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }

  return {
    client: client as unknown as SupabaseClient,
    builder,
    from: client.from,
  }
}
