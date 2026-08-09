import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TriageTool } from '@/lib/ai/tool-runner'
import { retrieveEvidenceMemory, retrieveAudienceMemory, retrieveBrandMemory, type MemoryQueryContext } from '@/lib/memory'
import { listCampaigns } from '@/lib/db/campaigns'
import { wrapEvidenceForPrompt, wrapToolResultForPrompt } from '@/lib/ai/wrap-evidence'

// ADR 0021 §2.2/§2.3 (Session 28 E5.5) — the closed four-tool inventory for
// Stage C's triage loop. Renamed from a draft's "search_*": the underlying
// MemoryQueryContext (lib/memory/scoring.ts) is used ONLY for in-process JS
// comparison, never a PostgREST predicate — "search" implies a capability
// this plumbing does not have.
//
// SIGNAL3-TOOLS-READ-ONLY — every tool is a bare read (retrieveEvidenceMemory
// / retrieveAudienceMemory / retrieveBrandMemory read through the
// lib/memory barrel, MEM-NO-DIRECT-TABLE-ACCESS; listCampaigns reads through
// lib/db directly, matching the ADR's own §2.2 citation). No tool calls
// .insert/.update/.upsert/.delete/.rpc — proven by the source scan in
// tools.test.ts, not by this comment alone.
//
// retrievePerformancePatterns is deliberately EXCLUDED — not an oversight.
// Its derived_from_metrics fallback arm (lib/memory/performance.ts:73-96)
// returns the same PerformancePattern type as the governed arm, and
// performance_memory ships empty (ADR 0019 §8.2) — every result today would
// be a metrics-derived row presented as governed memory, ADR 0019's named
// "category lie by construction." Do not add a fifth tool for it without
// re-opening that finding.

const RECENT_CAMPAIGNS_LIMIT = 5

// §2.3 layer 1 — the model-facing JSON Schema for every memory tool has NO
// businessId property; it can only express objective/platform/audience.
const QUERY_CONTEXT_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    objective: { type: 'string' },
    platform: { type: 'string' },
    audience: { type: 'string' },
  },
}

const EMPTY_JSON_SCHEMA = { type: 'object' as const, properties: {} }

// §2.3 layer 2 — z.strictObject REJECTS a smuggled businessId (or any other
// unknown key) before dispatch, rather than silently stripping it.
const queryContextInputSchema = z.strictObject({
  objective: z.string().optional(),
  platform: z.string().optional(),
  audience: z.string().optional(),
})
const emptyInputSchema = z.strictObject({})

function parseQueryContext(input: unknown): MemoryQueryContext {
  return queryContextInputSchema.parse(input)
}

// businessId and client are bound by closure — never accepted as a
// tool-input parameter, and unreachable by the model (§2.3). §2.3 layer 3
// (the dispatcher allowlist-checking the tool_use name against exactly this
// closed set, and hard-failing — absorbing as a malformed block — on
// anything else) lives in lib/ai/tool-runner.ts (built at E5.4); this
// function's job is only to return the closed four.
export function buildTriageTools(client: SupabaseClient, businessId: string): TriageTool[] {
  const listEvidence: TriageTool = {
    name: 'list_evidence',
    description:
      'List evidence memory (customer quotes, case studies, usage data) relevant to judging whether this release is worth surfacing.',
    inputSchema: QUERY_CONTEXT_JSON_SCHEMA,
    execute: async (input) => {
      const queryContext = parseQueryContext(input)
      const rows = await retrieveEvidenceMemory(client, businessId, queryContext)
      // Evidence keeps going through the EXISTING wrapEvidenceForPrompt
      // (§7.3) — it re-fetches business-scoped by id, the same guarantee
      // Stage D's citation render relies on (lib/ai/wrap-evidence.ts).
      // `ids` travels alongside the rendered block, structurally, so the
      // model can cite a SPECIFIC id (citableEvidenceIds) even though the
      // rendered text is one joined, guarded block rather than a per-row
      // list.
      const ids = rows.map((row) => row.id)
      const evidence = await wrapEvidenceForPrompt(client, businessId, ids)
      return { ids, evidence }
    },
  }

  const listAudienceNotes: TriageTool = {
    name: 'list_audience_notes',
    description: 'List audience memory (who cares about this release, and why) for this business.',
    inputSchema: QUERY_CONTEXT_JSON_SCHEMA,
    execute: async (input) => {
      const queryContext = parseQueryContext(input)
      const rows = await retrieveAudienceMemory(client, businessId, queryContext)
      return rows.map((row) => ({ id: row.id, statement: wrapToolResultForPrompt(row.statement) }))
    },
  }

  const listBrandClaims: TriageTool = {
    name: 'list_brand_claims',
    description: "List this business's own prior brand claims, to check whether a release conflicts with something already said.",
    inputSchema: QUERY_CONTEXT_JSON_SCHEMA,
    execute: async (input) => {
      const queryContext = parseQueryContext(input)
      const rows = await retrieveBrandMemory(client, businessId, queryContext)
      return rows.map((row) => ({ id: row.id, statement: wrapToolResultForPrompt(row.statement) }))
    },
  }

  const listRecentCampaigns: TriageTool = {
    name: 'list_recent_campaigns',
    description: "List this business's most recent campaigns, to check for redundancy against what was already said.",
    inputSchema: EMPTY_JSON_SCHEMA,
    execute: async (input) => {
      emptyInputSchema.parse(input)
      const rows = await listCampaigns(client, businessId, RECENT_CAMPAIGNS_LIMIT)
      return rows.map((row) => ({
        id: row.id,
        name: wrapToolResultForPrompt(row.name),
        objective: wrapToolResultForPrompt(row.objective),
        specialInstructions: row.special_instructions ? wrapToolResultForPrompt(row.special_instructions) : null,
      }))
    },
  }

  return [listEvidence, listAudienceNotes, listBrandClaims, listRecentCampaigns]
}
