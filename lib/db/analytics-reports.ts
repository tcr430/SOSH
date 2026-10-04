import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnalyticsReportRow } from './types'
import { getErrorMessage } from './utils'

// ADR 0031 §5.1, §9.1 rows 8 and 9 — the AUTHENTICATED reads of the immutable monthly report. Each takes the caller's
// client and a businessId and applies `.eq('business_id', businessId)` itself (RLS alone does not separate a user's two
// businesses). The service-role insert lands with the worker in O2.7; nothing here writes.

const LIST_MAX = 24

export async function getReportByPeriod(
  client: SupabaseClient,
  businessId: string,
  periodMonth: string,
): Promise<AnalyticsReportRow | null> {
  const { data, error } = await client
    .from('analytics_reports')
    .select('*')
    .eq('business_id', businessId)
    .eq('period_month', periodMonth)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as AnalyticsReportRow | null) ?? null
}

// By id AND business: a report id alone never reads across businesses.
export async function getReportById(
  client: SupabaseClient,
  businessId: string,
  reportId: string,
): Promise<AnalyticsReportRow | null> {
  const { data, error } = await client
    .from('analytics_reports')
    .select('*')
    .eq('business_id', businessId)
    .eq('id', reportId)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as AnalyticsReportRow | null) ?? null
}

// Newest month first, on the UNIQUE (business_id, period_month) index; at most 24 (two years).
export async function listReports(client: SupabaseClient, businessId: string, limit = LIST_MAX): Promise<AnalyticsReportRow[]> {
  const { data, error } = await client
    .from('analytics_reports')
    .select('*')
    .eq('business_id', businessId)
    .order('period_month', { ascending: false })
    .limit(Math.min(Math.max(Math.trunc(limit), 1), LIST_MAX))
  if (error) throw new Error(getErrorMessage(error))
  return (data as AnalyticsReportRow[]) ?? []
}
