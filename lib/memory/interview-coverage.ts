import type { SupabaseClient } from '@supabase/supabase-js'
import { listAudienceSlotRows } from '@/lib/db/memory-audience'
import { listBrandSlotRows } from '@/lib/db/memory-brand'
import { listEvidenceSlotRows } from '@/lib/db/memory-evidence'
import type { SlotRow } from '@/lib/interview/thinness'
import { toUtcIso } from '@/lib/utils'

// ADR 0029 §3.2 / §5.1 (Session 35 M2.7) — how the interview reads memory COVERAGE. The thinness function needs one
// business's active rows from all three governed stores, from EVERY source (an import row and an interview row cover a
// slot alike). MEM-NO-DIRECT-TABLE-ACCESS: lib/interview/ never names a *_memory table; it calls this, which calls
// lib/db/memory-*.ts. The three reads are independent and bounded (500 rows each), so they run in parallel.
//
// The result is a flat SlotRow[] the pure computeSlotThinness consumes. `client` is the CALLER's client: the /interview
// page reads with the member's own session (RLS applies, and every query also filters business_id explicitly).
export async function readInterviewSlotRows(client: SupabaseClient, businessId: string, now: Date): Promise<SlotRow[]> {
  const nowIso = toUtcIso(now)
  const [brand, audience, evidence] = await Promise.all([
    listBrandSlotRows(client, businessId, nowIso),
    listAudienceSlotRows(client, businessId, nowIso),
    listEvidenceSlotRows(client, businessId, nowIso),
  ])
  return [
    ...brand.map((r) => ({ type: 'brand' as const, category: r.category, status: r.status, recencyAt: r.recency_at, expiresAt: r.expires_at, deletedAt: r.deleted_at })),
    ...audience.map((r) => ({ type: 'audience' as const, category: r.kind, status: r.status, recencyAt: r.recency_at, expiresAt: r.expires_at, deletedAt: r.deleted_at })),
    ...evidence.map((r) => ({ type: 'evidence' as const, category: r.kind, status: r.status, recencyAt: r.recency_at, expiresAt: r.expires_at, deletedAt: r.deleted_at })),
  ]
}
