import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TriageTool } from '@/lib/ai/tool-runner'
import { retrieveEvidenceMemory, retrieveAudienceMemory, retrieveBrandMemory, type MemoryQueryContext } from '@/lib/memory'
import { listCampaigns } from '@/lib/db/campaigns'
import { getSignalForCampaign } from '@/lib/db/signals'
import { listRecentPublishedPostTexts } from '@/lib/db/posts'
import { wrapEvidenceForPrompt, wrapToolResultForPrompt, wrapSignalForPrompt, toToolResultId } from '@/lib/ai/wrap-evidence'
import { PLANNER_TOOL_NAMES } from './constants'

// ADR 0027 §2.3/§2.4/§2.5/§2.6/§6.3 (K2.4) — the campaign planner's closed six-tool inventory
// (AGENCY-TOOLS-CLOSED-INVENTORY). Every tool is a bare read, bound to client+businessId+campaignId by
// closure (AGENCY-TOOLS-TENANT-BOUND) — none of the three is ever a model-suppliable argument.
//
// CROSS-REFERENCE (ADR 0027 §2.3): the four memory tools here (list_evidence, list_brand_claims,
// list_audience_notes, list_recent_campaigns) are a DELIBERATE, DOCUMENTED DUPLICATION of
// lib/signals/triage/tools.ts's first four tools, not a shared import — lib/campaigns/planner importing
// lib/signals/triage would be a module-boundary violation, and extracting a shared builder into lib/ai/ would
// widen SANCTIONED_LIB_AI_IMPORTS over Stage C's already-reviewed surface for no gain. An undocumented
// duplication is an accident; this comment (and the twin one in lib/signals/triage/tools.ts) is the decision.
//
// AGENCY-NO-SERVICE-ROLE-IN-TOOLS: this module never imports lib/supabase/service. `client` is a caller-supplied
// parameter — the orchestrator (K2.7) is the layer allowed to acquire a service-role client; this module's job
// is only to close over whatever it is given.
//
// AGENCY-TOOL-RESULTS-GUARDED: every string field is wrapped PER FIELD before execute() returns —
// wrapToolResultForPrompt for tool-result text, wrapEvidenceForPrompt for the citation-by-id evidence block, and
// wrapSignalForPrompt (NOT wrapToolResultForPrompt, [sec-MINOR-8]) for get_campaign_signal — it already takes
// UntrustedText, the stronger, provenance-honest guard lib/db/signals.ts types title/body as.

const RECENT_CAMPAIGNS_LIMIT = 5
const RECENT_POSTS_LIMIT = 5

const QUERY_CONTEXT_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    objective: { type: 'string' },
    platform: { type: 'string' },
    audience: { type: 'string' },
  },
}

const EMPTY_JSON_SCHEMA = { type: 'object' as const, properties: {} }

// z.strictObject (§2.4 layer (b)) — a smuggled key is REJECTED, not silently stripped. Exported so the
// Tier-2 test can derive its expected JSON-Schema key set FROM the zod shape (test-Q1(b)) rather than hand-
// duplicating a second, driftable list of key names.
export const queryContextInputSchema = z.strictObject({
  objective: z.string().optional(),
  platform: z.string().optional(),
  audience: z.string().optional(),
})
export const emptyInputSchema = z.strictObject({})

function parseQueryContext(input: unknown): MemoryQueryContext {
  return queryContextInputSchema.parse(input)
}

// businessId AND campaignId are bound by closure — §2.4: neither is a property in any model-facing JSON
// Schema, and both new tools (get_campaign_signal, list_recent_posts) take NO model-supplied argument at all
// ([sec-Q4]) — an empty schema, not a filterable one.
export function buildPlannerTools(client: SupabaseClient, businessId: string, campaignId: string): TriageTool[] {
  const listEvidence: TriageTool = {
    name: 'list_evidence',
    description:
      'List evidence memory (customer quotes, case studies, usage data) relevant to this campaign, to check what can support a proposed change.',
    inputSchema: QUERY_CONTEXT_JSON_SCHEMA,
    execute: async (input) => {
      const queryContext = parseQueryContext(input)
      const rows = await retrieveEvidenceMemory(client, businessId, queryContext)
      const rawIds = rows.map((row) => row.id)
      const evidence = await wrapEvidenceForPrompt(client, businessId, rawIds)
      const ids = rawIds.map(toToolResultId)
      return { ids, evidence }
    },
  }

  const listBrandClaims: TriageTool = {
    name: 'list_brand_claims',
    description: "List this business's own prior brand claims, to check whether a proposed change conflicts with something already said.",
    inputSchema: QUERY_CONTEXT_JSON_SCHEMA,
    execute: async (input) => {
      const queryContext = parseQueryContext(input)
      const rows = await retrieveBrandMemory(client, businessId, queryContext)
      return rows.map((row) => ({ id: toToolResultId(row.id), statement: wrapToolResultForPrompt(row.statement) }))
    },
  }

  const listAudienceNotes: TriageTool = {
    name: 'list_audience_notes',
    description: 'List audience memory (who this content is for, and what they care about) for this business.',
    inputSchema: QUERY_CONTEXT_JSON_SCHEMA,
    execute: async (input) => {
      const queryContext = parseQueryContext(input)
      const rows = await retrieveAudienceMemory(client, businessId, queryContext)
      return rows.map((row) => ({ id: toToolResultId(row.id), statement: wrapToolResultForPrompt(row.statement) }))
    },
  }

  const listRecentCampaigns: TriageTool = {
    name: 'list_recent_campaigns',
    description: "List this business's most recent campaigns, to check for redundancy against what was already planned.",
    inputSchema: EMPTY_JSON_SCHEMA,
    execute: async (input) => {
      emptyInputSchema.parse(input)
      const rows = await listCampaigns(client, businessId, RECENT_CAMPAIGNS_LIMIT)
      return rows.map((row) => ({
        id: toToolResultId(row.id),
        name: wrapToolResultForPrompt(row.name),
        objective: wrapToolResultForPrompt(row.objective),
        specialInstructions: row.special_instructions ? wrapToolResultForPrompt(row.special_instructions) : null,
      }))
    },
  }

  const getCampaignSignal: TriageTool = {
    name: 'get_campaign_signal',
    description: 'Get the source signal (release, article) this campaign was seeded from, if any.',
    inputSchema: EMPTY_JSON_SCHEMA,
    execute: async (input) => {
      emptyInputSchema.parse(input)
      const signal = await getSignalForCampaign(client, businessId, campaignId)
      if (!signal) return { signal: null }
      return { signal: wrapSignalForPrompt({ title: signal.title, body: signal.body }) }
    },
  }

  const listRecentPosts: TriageTool = {
    name: 'list_recent_posts',
    description: "List this business's most recently published post texts, to check for redundancy or repeated phrasing.",
    inputSchema: EMPTY_JSON_SCHEMA,
    execute: async (input) => {
      emptyInputSchema.parse(input)
      const texts = await listRecentPublishedPostTexts(client, businessId, RECENT_POSTS_LIMIT)
      return texts.map((text) => wrapToolResultForPrompt(text))
    },
  }

  const tools = [listEvidence, listBrandClaims, listAudienceNotes, listRecentCampaigns, getCampaignSignal, listRecentPosts]
  // AGENCY-TOOLS-CLOSED-INVENTORY (constraint 2) — pinned at construction, not only by the Tier-2 test, so a
  // drive-by addition here fails immediately rather than only in CI.
  const names = tools.map((t) => t.name)
  const expected: readonly string[] = PLANNER_TOOL_NAMES
  if (names.length !== expected.length || names.some((n, i) => n !== expected[i])) {
    throw new Error(`buildPlannerTools tool set drifted from PLANNER_TOOL_NAMES: got [${names.join(', ')}]`)
  }
  return tools
}
