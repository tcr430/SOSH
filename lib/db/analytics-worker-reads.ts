import type { SupabaseClient } from '@supabase/supabase-js'
import { selectOutcomePatterns } from '@/lib/memory/outcomes'
import { assertOwned } from '@/lib/reports/isolation'
import { getBusinessByIdForWorker } from './businesses'
import { listOutcomePatterns } from './memory-performance'
import { listCampaignsByIds } from './campaigns'
import { listCompletedRetrospectivesInRange } from './campaign-retrospectives'
import { listMetricsForPosts } from './post-metrics'
import { listDimensionsForAnalytics, listMonthOutcomes, listTrendOutcomes } from './post-outcomes'
import { countPublishedPostsInRange, listPublishedPostsInRange } from './posts'
import { listAccountLabels } from './social-accounts'

// ADR 0031 §9.3 — the report worker's reads: the SAME bodies as the authenticated ones (so the page and the report can
// never disagree about what a number is), bound to a service-role client acquired here, lazily, so it is never bundled
// into client code. No function takes a client or a query builder: every one takes a businessId and applies
// .eq('business_id', businessId) itself, and every selected shape includes business_id. The assembler then verifies every
// returned row against the loop's business (lib/reports/isolation.ts), because here RLS is bypassed.

async function service(): Promise<SupabaseClient> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  return createServiceRoleClient()
}

export function analyticsWorkerReaders() {
  return {
    getBusinessById: (businessId: string) => getBusinessByIdForWorker(businessId),
    listCampaignsByIds: async (businessId: string, ids: readonly string[]) => listCampaignsByIds(await service(), businessId, ids),
    listCompletedRetrospectivesInRange: async (businessId: string, range: { start: string; end: string }) =>
      listCompletedRetrospectivesInRange(await service(), businessId, range),
    listPublishedPostsInRange: async (businessId: string, range: { start: string; end: string }) =>
      listPublishedPostsInRange(await service(), businessId, range),
    countPublishedPostsInRange: async (businessId: string, range: { start: string; end: string }) =>
      countPublishedPostsInRange(await service(), businessId, range),
    listMonthOutcomes: async (businessId: string, q: Parameters<typeof listMonthOutcomes>[2]) => listMonthOutcomes(await service(), businessId, q),
    listTrendOutcomes: async (businessId: string, q: Parameters<typeof listTrendOutcomes>[2]) => listTrendOutcomes(await service(), businessId, q),
    listDimensionsForAnalytics: async (businessId: string, ids: readonly string[]) => listDimensionsForAnalytics(await service(), businessId, ids),
    listMetricsForPosts: async (businessId: string, ids: readonly string[]) => listMetricsForPosts(await service(), businessId, ids),
    listAccountLabels: async (businessId: string, ids: readonly string[]) => listAccountLabels(await service(), businessId, ids),
    // The SAME query body the page runs (listOutcomePatterns, which applies .eq('business_id')) and the SAME pure
    // selection, bound to the service-role client acquired here. Ownership is asserted on the RAW rows, BEFORE the
    // selection: the selection drops ineligible and over-cap rows, and a foreign row dropped there would never raise the
    // alarm (security-reviewer, Session 37-D D1). verifiedReaders then checks the selected rows again.
    listPatterns: async (businessId: string, options: { platform?: string }) => {
      const rows = await listOutcomePatterns(await service(), businessId, { status: 'active', platform: options.platform })
      assertOwned(businessId, rows, 'listPatterns (raw rows)')
      return selectOutcomePatterns(rows, options)
    },
  }
}
