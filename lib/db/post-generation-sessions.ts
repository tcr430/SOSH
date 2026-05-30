import { formatISO, subMinutes } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  GenerationSessionRow,
  GenerationSessionInsert,
  GenerationSessionUpdate,
} from './types'

export async function createGenerationSession(
  client: SupabaseClient,
  input: GenerationSessionInsert,
): Promise<GenerationSessionRow> {
  const { data, error } = await client
    .from('post_generation_sessions')
    .insert(input)
    .select()
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!data) throw new Error('Failed to create generation session')
  return data as GenerationSessionRow
}

export async function getGenerationSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<GenerationSessionRow | null> {
  const { data, error } = await client
    .from('post_generation_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle()
  if (error) throw new Error((error as { message: string }).message)
  return (data as GenerationSessionRow | null) ?? null
}

export async function updateGenerationSessionStatus(
  client: SupabaseClient,
  sessionId: string,
  patch: GenerationSessionUpdate,
): Promise<void> {
  const { error } = await client
    .from('post_generation_sessions')
    .update(patch)
    .eq('id', sessionId)
  if (error) throw new Error((error as { message: string }).message)
}

export async function recoverStuckGenerationSessions(
  client: SupabaseClient,
  opts: { now: Date; staleMinutes: number },
): Promise<number> {
  const cutoff = formatISO(subMinutes(opts.now, opts.staleMinutes))
  const { data, error } = await client
    .from('post_generation_sessions')
    .update({
      status: 'failed',
      error_code: 'timeout',
      completed_at: formatISO(opts.now),
    })
    .eq('status', 'generating')
    .lt('started_at', cutoff)
    .select('id')
  if (error) throw new Error((error as { message: string }).message)
  return (data as { id: string }[] | null)?.length ?? 0
}
