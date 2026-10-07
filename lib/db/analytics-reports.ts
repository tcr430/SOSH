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

// The list page's index: id, month and whether it is a stub, and NOTHING else. `listReports` selects `*`, which carries the whole
// payload of up to 24 reports for a page that reads one flag (react review, O2.10). `stub:payload->>stub` is a jsonb path, so the
// payload itself never leaves the database. Same filter, order and bound as listReports.
export interface ReportIndexRow {
  id: string
  period_month: string
  stub: boolean
}

export async function listReportIndex(client: SupabaseClient, businessId: string, limit = LIST_MAX): Promise<ReportIndexRow[]> {
  const { data, error } = await client
    .from('analytics_reports')
    .select('id, period_month, stub:payload->>stub')
    .eq('business_id', businessId)
    .order('period_month', { ascending: false })
    .limit(Math.min(Math.max(Math.trunc(limit), 1), LIST_MAX))
  if (error) throw new Error(getErrorMessage(error))
  return ((data as Array<{ id: string; period_month: string; stub: string | boolean | null }> | null) ?? []).map((r) => ({
    id: r.id,
    period_month: r.period_month,
    stub: r.stub === true || r.stub === 'true',
  }))
}

// ── The worker's writes and reads (service-role, lazy import, NO client parameter; ADR 0031 §5.2, §9.3) ───────────

export type AnalyticsReportInsert = Omit<AnalyticsReportRow, 'id'>

// INSERT ... ON CONFLICT (business_id, period_month) DO NOTHING, as a direct insert: no RPC, so no new SECURITY DEFINER
// function. Returns whether a row came back (false = a report for the period already existed: the overlapping tick
// lost). The row's business_id and tier are the CALLER's loop variable and plan read, never a payload field.
export async function insertAnalyticsReport(insert: AnalyticsReportInsert): Promise<boolean> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('analytics_reports')
    .upsert(insert, { onConflict: 'business_id,period_month', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(getErrorMessage(error))
  return (data ?? []).length > 0
}

export interface ReportForRedelivery {
  generated_at: string
  stub: boolean
  summary: Array<{ key: string; params: Record<string, unknown> }>
}

// MINOR-8 (A-13(a)): what the worker needs to re-send an EXISTING report's email: when it was generated, whether it is a stub, and its
// stored summary lines. Read only when the probe says the report exists; null when it does not.
export async function getReportForRedeliveryForWorker(businessId: string, periodMonth: string): Promise<ReportForRedelivery | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('analytics_reports')
    .select('generated_at, stub:payload->stub, summary:payload->summary')
    .eq('business_id', businessId)
    .eq('period_month', periodMonth)
    .limit(1)
  if (error) throw new Error(getErrorMessage(error))
  const row = (data ?? [])[0] as { generated_at: string; stub: unknown; summary: unknown } | undefined
  if (!row) return null
  // A stored report that cannot say whether it is a stub, or whose summary is not a non-empty list, is an ERROR, not a default: a
  // missing flag read as "not a stub" and a missing summary read as [] would re-send a blank email (silent-failure-hunter M2).
  if (typeof row.stub !== 'boolean') throw new Error('stored report has no boolean stub flag (' + businessId + ', ' + periodMonth + ')')
  if (!Array.isArray(row.summary) || (row.stub === false && row.summary.length === 0)) throw new Error('stored report has no summary list (' + businessId + ', ' + periodMonth + ')')
  return { generated_at: row.generated_at, stub: row.stub, summary: row.summary as ReportForRedelivery['summary'] }
}

// The anti-join probe on the unique key: does this business already have a report for the month?
export async function analyticsReportExistsForWorker(businessId: string, periodMonth: string): Promise<boolean> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('analytics_reports')
    .select('id')
    .eq('business_id', businessId)
    .eq('period_month', periodMonth)
    .limit(1)
  if (error) throw new Error(getErrorMessage(error))
  return (data ?? []).length > 0
}
