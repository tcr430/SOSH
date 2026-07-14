import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

function buildQueryBuilder(result: { data: unknown; error: unknown; count?: number | null }) {
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

  return builder
}

export function createMockClient(data: unknown = null, error: unknown = null) {
  const builder = buildQueryBuilder({ data, error })

  const client = {
    from: vi.fn().mockReturnValue(builder),
    rpc: vi.fn().mockResolvedValue({ data, error }),
  }

  return {
    client: client as unknown as SupabaseClient,
    builder,
    from: client.from,
  }
}

// For functions that issue MORE THAN ONE client.from(...) query per call (e.g. a
// bounded rows query followed by a separate unbounded count query) and need each
// to resolve independently — createMockClient's single shared builder can't
// express that, since every chain method returns the SAME result.
export function createSequentialMockClient(
  results: Array<{ data: unknown; error: unknown; count?: number | null }>,
) {
  const builders = results.map(buildQueryBuilder)
  const from = vi.fn()
  for (const b of builders) from.mockReturnValueOnce(b)

  const client = { from, rpc: vi.fn() }

  return {
    client: client as unknown as SupabaseClient,
    builders,
    from,
  }
}
