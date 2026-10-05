import type { Readers } from '@/lib/analytics/load'

// ADR 0031 §9.3 (REPORT-RLS-ISOLATED, [sec-2]) — the report worker runs as service-role, RLS is bypassed, so the
// business_id filter is the ONLY boundary. Every read the assembler makes goes through these wrappers, which compare
// every returned row's business_id with the loop's businessId. ONE mismatch THROWS and aborts that business's report:
// a mismatched row is never skipped (skipping would hide the leak and still ship a report built beside it).

export class TenantMismatchError extends Error {
  readonly businessId: string
  readonly foundBusinessId: string | undefined
  readonly read: string

  constructor(businessId: string, foundBusinessId: string | undefined, read: string) {
    super('report isolation: ' + read + ' returned a row for business ' + String(foundBusinessId) + ' inside the run for ' + businessId)
    this.name = 'TenantMismatchError'
    this.businessId = businessId
    this.foundBusinessId = foundBusinessId
    this.read = read
  }
}

/** Every row must carry the loop's business id. A row WITHOUT one is a mismatch too: every selected shape includes business_id. */
export function assertOwned(businessId: string, rows: ReadonlyArray<{ business_id?: string | null }>, read: string): void {
  for (const row of rows) {
    if (row.business_id !== businessId) throw new TenantMismatchError(businessId, row.business_id ?? undefined, read)
  }
}

export function verifiedReaders(base: Readers, businessId: string): Readers {
  // The id a reader is CALLED with must be the loop's too.
  const same = (id: string, read: string) => {
    if (id !== businessId) throw new TenantMismatchError(businessId, id, read + ' (call argument)')
  }
  const rows = async <R extends { business_id?: string | null }>(id: string, read: string, fetch: () => Promise<R[]>): Promise<R[]> => {
    same(id, read)
    const out = await fetch()
    assertOwned(businessId, out, read)
    return out
  }
  return {
    getBusinessById: async (id) => {
      same(id, 'getBusinessById')
      const row = await base.getBusinessById(id)
      if (row.id !== businessId) throw new TenantMismatchError(businessId, row.id, 'getBusinessById')
      return row
    },
    listCampaigns: (id) => rows(id, 'listCampaigns', () => base.listCampaigns(id)),
    listCompletedRetrospectivesInRange: (id, range) => rows(id, 'listCompletedRetrospectivesInRange', () => base.listCompletedRetrospectivesInRange(id, range)),
    listPublishedPostsInRange: (id, range) => rows(id, 'listPublishedPostsInRange', () => base.listPublishedPostsInRange(id, range)),
    countPublishedPostsInRange: async (id, range) => {
      same(id, 'countPublishedPostsInRange')
      return base.countPublishedPostsInRange(id, range)
    },
    listMonthOutcomes: (id, q) => rows(id, 'listMonthOutcomes', () => base.listMonthOutcomes(id, q)),
    listTrendOutcomes: (id, q) => rows(id, 'listTrendOutcomes', () => base.listTrendOutcomes(id, q)),
    listDimensionsForAnalytics: (id, ids) => rows(id, 'listDimensionsForAnalytics', () => base.listDimensionsForAnalytics(id, ids)),
    listMetricsForPosts: (id, ids) => rows(id, 'listMetricsForPosts', () => base.listMetricsForPosts(id, ids)),
    listAccountLabels: (id, ids) => rows(id, 'listAccountLabels', () => base.listAccountLabels(id, ids)),
  }
}
