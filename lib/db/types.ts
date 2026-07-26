/**
 * TypeScript types for all SŌSH database tables.
 *
 * Conventions:
 * - Row    — exact DB representation; matches every column including nulls.
 * - Insert — fields with DB defaults are optional; required fields stay required.
 * - Update — all fields optional (use with .eq('id', …).update(…)).
 * - Enum types are string literal unions, never TypeScript enums.
 * - Timestamps are string (ISO-8601); localisation is done in the app via date-fns.
 * - JSONB columns are Record<string, unknown> where the shape is open,
 *   or a named type where the shape is structurally enforced (e.g. VoiceAxes).
 */

import type { VoiceAxes } from '@/lib/validation/voice'
export type { VoiceAxes }

// ---------------------------------------------------------------------------
// Shared utility types
// ---------------------------------------------------------------------------

// Branded type for Supabase Vault secret IDs. Prevents accidentally passing
// a plain string where a vault UUID is required.
export type VaultSecretId = string & { readonly _brand: 'VaultSecretId' }

// ---------------------------------------------------------------------------
// Shared enum types
// ---------------------------------------------------------------------------

export type Plan = 'trial' | 'plus' | 'pro' | 'agency'
export type Language = 'en' | 'pt' | 'es'
export type Platform = 'linkedin' | 'twitter' | 'instagram' | 'facebook' | 'threads'
export type CampaignFrequency = 'daily' | '3x_week' | 'weekly' | 'custom'
export type CampaignStatus = 'draft' | 'awaiting_brief' | 'active' | 'paused' | 'completed'
export type CampaignOrigin = 'manual' | 'objective_generated' | 'signal_generated'
export type PostStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'failed' | 'skipped'
// Campaign post-role vocabulary (ADR 0017 §3.2, L-5) — distinct from the
// thread-internal tweet-role (hook|body|pull_quote|close, L-4), which lives
// inside the thread format-family JSON and never touches this type.
export type PostRole =
  | 'anchor_thesis'
  | 'founder_perspective'
  | 'customer_proof'
  | 'objection_response'
  | 'conversation_starter'
  | 'follow_up'
export type EngagementType = 'comment' | 'dm' | 'mention'
export type EngagementSentiment = 'positive' | 'neutral' | 'negative' | 'urgent'
export type EngagementStatus = 'pending' | 'replied' | 'ignored' | 'auto_replied'
export type EmailKind =
  | 'trial-warning-t3'
  | 'trial-warning-t1'
  | 'welcome-to-plan'
  | 'payment-failed-courtesy'
  | 'first-post-published'
  | 'team-invite'
export type EmailOutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'suppressed'
export type EmailSuppressionReason = 'bounce' | 'complaint' | 'manual'
export type MemberRole = 'approver' | 'editor' | 'viewer'
export type MemberStatus = 'invited' | 'active' | 'revoked'

// ---------------------------------------------------------------------------
// 1. businesses
// ---------------------------------------------------------------------------

export type BusinessRow = {
  id: string
  name: string
  website: string | null
  industry: string | null
  description: string | null
  logo_url: string | null
  owner_id: string
  plan: Plan
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  language: Language
  timezone: string
  onboarding_completed: boolean
  total_posts_published: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type BusinessInsert = {
  id?: string
  name: string
  website?: string | null
  industry?: string | null
  description?: string | null
  logo_url?: string | null
  owner_id: string
  plan?: Plan
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  language?: Language
  timezone?: string
  onboarding_completed?: boolean
  total_posts_published?: number
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

export type BusinessUpdate = Partial<Omit<BusinessRow, 'id' | 'created_at' | 'plan' | 'stripe_customer_id' | 'stripe_subscription_id' | 'deleted_at'>>

// ---------------------------------------------------------------------------
// 2. brand_voices
// ---------------------------------------------------------------------------

export type BrandVoiceRow = {
  id: string
  business_id: string
  voice_axes: VoiceAxes
  tone: string[]
  target_audience: string | null
  keywords: string[]
  avoid_words: string[]
  writing_examples: string[]
  competitors: string[]
  unique_value_prop: string | null
  inferred_from_url: string | null
  created_at: string
  updated_at: string
}

export type BrandVoiceInsert = {
  id?: string
  business_id: string
  voice_axes?: VoiceAxes
  tone?: string[]
  target_audience?: string | null
  keywords?: string[]
  avoid_words?: string[]
  writing_examples?: string[]
  competitors?: string[]
  unique_value_prop?: string | null
  inferred_from_url?: string | null
  created_at?: string
  updated_at?: string
}

export type BrandVoiceUpdate = Partial<Omit<BrandVoiceRow, 'id' | 'created_at'>>

// ---------------------------------------------------------------------------
// 2a. brand_voice_variations (ADR 0011 §3.2)
// ---------------------------------------------------------------------------

export type BrandVoiceVariationRow = {
  id: string
  business_id: string
  name: string
  voice_axes: VoiceAxes
  created_at: string
  updated_at: string
}

export type BrandVoiceVariationInsert = {
  id?: string
  business_id: string
  name: string
  voice_axes: VoiceAxes
  created_at?: string
  updated_at?: string
}

// ---------------------------------------------------------------------------
// 3. social_accounts
// ---------------------------------------------------------------------------

export type SocialAccountRow = {
  id: string
  business_id: string
  platform: Platform
  platform_user_id: string
  platform_username: string
  platform_display_name: string | null
  vault_access_token_id: VaultSecretId
  vault_refresh_token_id: VaultSecretId | null
  token_expires_at: string | null
  is_active: boolean
  connected_at: string
  created_at: string
  updated_at: string
}

export type SocialAccountInsert = {
  id?: string
  business_id: string
  platform: Platform
  platform_user_id: string
  platform_username: string
  platform_display_name?: string | null
  vault_access_token_id: VaultSecretId
  vault_refresh_token_id?: VaultSecretId | null
  token_expires_at?: string | null
  is_active?: boolean
  connected_at?: string
  created_at?: string
  updated_at?: string
}

export type SocialAccountUpdate = Partial<Omit<SocialAccountRow, 'id' | 'created_at' | 'vault_access_token_id' | 'vault_refresh_token_id'>> & {
  vault_access_token_id?: VaultSecretId | null
  vault_refresh_token_id?: VaultSecretId | null
}

// ---------------------------------------------------------------------------
// 4. campaigns
// ---------------------------------------------------------------------------

export type CampaignRow = {
  id: string
  business_id: string
  name: string
  objective: string
  special_instructions: string | null
  platforms: Platform[]
  frequency: CampaignFrequency
  posts_per_week: number
  start_date: string
  end_date: string | null
  status: CampaignStatus
  total_posts_planned: number
  total_posts_published: number
  voice_variation_id: string | null
  origin: CampaignOrigin
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type CampaignInsert = {
  id?: string
  business_id: string
  name: string
  objective: string
  special_instructions?: string | null
  platforms: Platform[]
  frequency: CampaignFrequency
  posts_per_week: number
  start_date: string
  end_date?: string | null
  status?: CampaignStatus
  total_posts_planned?: number
  total_posts_published?: number
  voice_variation_id?: string | null
  // Required (ADR 0017 §3.1, [db-MAJOR-3]): the DB column has no default
  // after backfill, so every call site must state its origin explicitly
  // rather than silently mislabeling Mode 1/3 rows as objective_generated.
  origin: CampaignOrigin
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

export type CampaignUpdate = Partial<Omit<CampaignRow, 'id' | 'created_at' | 'deleted_at' | 'business_id'>>

// ---------------------------------------------------------------------------
// 5. posts — flat model (one row per campaign × platform, no post_variants)
// ---------------------------------------------------------------------------

export type PostRow = {
  id: string
  campaign_id: string
  business_id: string
  platform: Platform
  content: string
  hashtags: string[]
  media_urls: string[]
  scheduled_at: string
  published_at: string | null
  platform_post_id: string | null
  platform_url: string | null
  status: PostStatus
  // Campaign post-role (ADR 0017 §3.2). NULL for pre-Mode-2 rows and for any
  // row not yet assigned one; write-once once set (DB trigger enforces the
  // service-role write path; this Omit-exclusion from PostUpdate below
  // enforces the app-layer authenticated path).
  role: PostRole | null
  rejection_note: string | null
  ai_generation_metadata: Record<string, unknown>
  publish_attempts: number
  last_publish_attempt_at: string | null
  last_publish_error: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type PostInsert = {
  id?: string
  campaign_id: string
  business_id: string
  platform: Platform
  content: string
  // Optional (B2.6): the service-role generation orchestrator (generate.ts)
  // sets this from the frozen brief's roleSequence at insert time. Absent
  // for any pre-Mode-2 or non-brief-routed insert path. Write-once from here
  // on (PostUpdate omits it, and the DB trigger enforces it regardless of
  // caller — ADR 0017 §3.2).
  role?: PostRole | null
  hashtags?: string[]
  media_urls?: string[]
  scheduled_at: string
  published_at?: string | null
  platform_post_id?: string | null
  platform_url?: string | null
  status?: PostStatus
  rejection_note?: string | null
  ai_generation_metadata?: AiGenerationMetadata | Record<string, unknown>
  publish_attempts?: number
  last_publish_attempt_at?: string | null
  last_publish_error?: string | null
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

export type PostUpdate = Partial<Omit<PostRow, 'id' | 'created_at' | 'business_id' | 'campaign_id' | 'published_at' | 'platform_post_id' | 'platform_url' | 'deleted_at' | 'role'>>

// ---------------------------------------------------------------------------
// 6. post_metrics — upsert-in-place; nullable metrics mean "not exposed by platform"
// ---------------------------------------------------------------------------

export type PostMetricsRow = {
  id: string
  post_id: string
  business_id: string
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  clicks: number | null
  reach: number | null
  impressions: number | null
  last_synced_at: string
  created_at: string
  updated_at: string
}

export type PostMetricsInsert = {
  id?: string
  post_id: string
  business_id: string
  likes?: number | null
  comments?: number | null
  shares?: number | null
  saves?: number | null
  clicks?: number | null
  reach?: number | null
  impressions?: number | null
  last_synced_at?: string
  created_at?: string
  updated_at?: string
}

export type PostMetricsUpdate = Partial<Omit<PostMetricsRow, 'id' | 'created_at'>>

// ---------------------------------------------------------------------------
// 7. engagement_inbox
// ---------------------------------------------------------------------------

export type EngagementInboxRow = {
  id: string
  business_id: string
  post_id: string | null
  platform: Platform
  type: EngagementType
  platform_item_id: string
  author_username: string
  author_display_name: string | null
  content: string
  received_at: string
  sentiment: EngagementSentiment | null
  ai_draft_reply: string | null
  status: EngagementStatus
  replied_at: string | null
  created_at: string
  updated_at: string
}

export type EngagementInboxInsert = {
  id?: string
  business_id: string
  post_id?: string | null
  platform: Platform
  type: EngagementType
  platform_item_id: string
  author_username: string
  author_display_name?: string | null
  content: string
  received_at: string
  sentiment?: EngagementSentiment | null
  ai_draft_reply?: string | null
  status?: EngagementStatus
  replied_at?: string | null
  created_at?: string
  updated_at?: string
}

export type EngagementInboxUpdate = Partial<Omit<EngagementInboxRow, 'id' | 'created_at'>>

// ---------------------------------------------------------------------------
// 8. trial_state — written by service-role only; app reads via SELECT
// ---------------------------------------------------------------------------

export type TrialStateRow = {
  id: string
  business_id: string
  trial_started_at: string | null
  campaigns_created_count: number
  posts_generated_count: number
  brand_voice_inference_attempts: number
  work_email_verified: boolean
  trial_card_fingerprint: string | null
  created_at: string
  updated_at: string
}

export type TrialStateInsert = {
  id?: string
  business_id: string
  trial_started_at?: string | null
  campaigns_created_count?: number
  posts_generated_count?: number
  brand_voice_inference_attempts?: number
  work_email_verified?: boolean
  trial_card_fingerprint?: string | null
  created_at?: string
  updated_at?: string
}

export type TrialStateUpdate = Partial<Omit<TrialStateRow, 'id' | 'created_at'>>

// Excludes the billing-sensitive fingerprint — returned by the default
// getTrialState(). Use getTrialStateForBilling() (service-role) for the full row.
export type TrialStatePublicRow = Omit<TrialStateRow, 'trial_card_fingerprint'>

// ---------------------------------------------------------------------------
// 9. ai_usage — append-only; no updated_at; no write RLS for authenticated
// ---------------------------------------------------------------------------

export type AiUsageRow = {
  id: string
  business_id: string
  prompt_id: string
  prompt_version: number
  model: string
  input_tokens: number
  output_tokens: number
  cost_cents: number
  latency_ms: number
  success: boolean
  error_code: string | null
  created_at: string
}

export type AiUsageInsert = {
  id?: string
  business_id: string
  prompt_id: string
  prompt_version: number
  model: string
  input_tokens: number
  output_tokens: number
  cost_cents: number
  latency_ms: number
  success: boolean
  error_code?: string | null
  created_at?: string
}

// ---------------------------------------------------------------------------
// 10. post_generation_sessions — written by service-role orchestrator only
// ---------------------------------------------------------------------------

export type GenerationSessionStatus = 'pending' | 'generating' | 'complete' | 'failed'

export type GenerationSessionRow = {
  id: string
  business_id: string
  campaign_id: string
  status: GenerationSessionStatus
  error_code: string | null
  posts_planned: number
  posts_created: number
  started_at: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type GenerationSessionInsert = {
  id?: string
  business_id: string
  campaign_id: string
  status?: GenerationSessionStatus
  error_code?: string | null
  posts_planned: number
  posts_created?: number
  started_at?: string
  completed_at?: string | null
  created_at?: string
  updated_at?: string
}

export type GenerationSessionUpdate = Partial<
  Pick<GenerationSessionRow, 'status' | 'error_code' | 'posts_created' | 'completed_at'>
>

// ---------------------------------------------------------------------------
// AI generation metadata — stored in posts.ai_generation_metadata (JSONB)
// ---------------------------------------------------------------------------

export interface AiGenerationMetadata {
  promptId: string
  promptVersion: number
  model: string
  generationSessionId: string
  platformContext: string
  platformConstraintsVersion: number
  rationale: string
  regenerationCount: number
  previousVersions: Array<{
    content: string
    rejectionNote: string | null
    regeneratedAt: string
  }>
  generatedAt: string
}

// ---------------------------------------------------------------------------
// 11. email_outbox — durable queue for product transactional email (ADR 0008 §5)
// ---------------------------------------------------------------------------

export type EmailOutboxRow = {
  id: string
  business_id: string
  kind: EmailKind
  recipient: string
  locale: Language
  props: Record<string, unknown>
  dedupe_token: string | null
  status: EmailOutboxStatus
  attempts: number
  next_attempt_at: string | null
  last_error: string | null
  provider_message_id: string | null
  created_at: string
  updated_at: string
  sent_at: string | null
}

// ---------------------------------------------------------------------------
// 12. email_suppressions — addresses never to email (ADR 0008 §6)
// ---------------------------------------------------------------------------

export type EmailSuppressionRow = {
  email: string
  reason: EmailSuppressionReason
  source_event_id: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// 13. email_webhook_events — audit log for Resend webhook events (ADR 0008 §14)
// ---------------------------------------------------------------------------

export type EmailWebhookEventRow = {
  id: string
  event_type: string
  payload: Record<string, unknown>
  received_at: string
}

// ---------------------------------------------------------------------------
// 14. business_members — seats & permissions (ADR 0013 §2)
// ---------------------------------------------------------------------------

export type BusinessMemberRow = {
  id: string
  business_id: string
  user_id: string | null
  email: string
  role: MemberRole
  is_admin: boolean
  status: MemberStatus
  invited_by: string | null
  invited_at: string
  accepted_at: string | null
  created_at: string
  updated_at: string
}

export type BusinessMemberInsert = {
  id?: string
  business_id: string
  user_id?: string | null
  email: string
  role: MemberRole
  is_admin?: boolean
  status?: MemberStatus
  invited_by?: string | null
  invited_at?: string
  accepted_at?: string | null
  created_at?: string
  updated_at?: string
}

export type BusinessMemberUpdate = Partial<
  Omit<BusinessMemberRow, 'id' | 'created_at' | 'business_id' | 'invited_by' | 'invited_at'>
>

// ---------------------------------------------------------------------------
// 15. Governed memory (ADR 0016) — brand_memory, evidence_memory,
//     audience_memory, performance_memory
// ---------------------------------------------------------------------------

export type MemorySource = 'manual' | 'distilled' | 'import'
export type MemoryStatus = 'candidate' | 'active' | 'retired'
export type MemorySensitivity = 'public' | 'internal' | 'confidential'
export type MemoryScope = 'brand' | 'campaign' | 'platform' | 'contact'

// The governance column block (ADR 0016 §2) shared by all four memory
// tables. `recency_at` is a STORED generated column
// (`COALESCE(last_confirmed_at, created_at)`, migration 20260719020000)
// that lets PostgREST .order() reference the retrieval index's sort key
// directly — see ADR §5.3 and lib/db/memory-*.ts.
type MemoryGovernanceRow = {
  id: string
  business_id: string
  source: MemorySource
  confidence: number
  observation_count: number
  status: MemoryStatus
  sensitivity: MemorySensitivity
  public_use_permission: boolean
  scope: MemoryScope
  scope_ref: string | null
  last_confirmed_at: string | null
  recency_at: string
  expires_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type BrandMemoryCategory = 'positioning' | 'capability' | 'pricing' | 'competitor' | 'other'

export type BrandMemoryRow = MemoryGovernanceRow & {
  category: BrandMemoryCategory
  statement: string
}

export type EvidenceMemoryKind = 'quote' | 'case_study' | 'usage_data' | 'other'

export type EvidenceMemoryRow = MemoryGovernanceRow & {
  kind: EvidenceMemoryKind
  content: string
  source_url: string | null
}

export type AudienceMemoryKind = 'problem' | 'objection' | 'question' | 'trigger' | 'other'

export type AudienceMemoryRow = MemoryGovernanceRow & {
  segment: string | null
  kind: AudienceMemoryKind
  statement: string
}

export type PerformanceMemoryDimension = 'topic' | 'hook' | 'format' | 'proof_type'

export type PerformanceMemoryRow = MemoryGovernanceRow & {
  dimension: PerformanceMemoryDimension
  pattern: string
  platform: Platform | null
  // ADR 0016 Amendment B / ADR 0018 §7.2 (Session 25 C2.3 migration,
  // C2.6 type addition) — the deterministic dedup/aggregation key for
  // distilled rows; NULL for source='manual'/'import' rows, which have no
  // signal-derived identity. Was missing from this type since the C2.3
  // migration added the column — added now because C2.6 is the first
  // writer/reader that needs it in TypeScript.
  pattern_key: string | null
}

// Session 25 C2.6 — the FIRST writer for this table (ADR 0018 §7.1). The
// governance columns source/status/sensitivity/public_use_permission are
// NOT part of this Insert type: they are fixed by the
// upsert_distilled_performance_pattern RPC itself (lib/db/memory-performance.ts),
// never caller-supplied, so there is no way to call the writer with a wrong
// governance value. last_confirmed_at/expires_at are likewise RPC-computed
// (now() / now()+90d), not caller inputs.
export type PerformanceMemoryInsert = {
  business_id: string
  dimension: PerformanceMemoryDimension
  pattern: string
  pattern_key: string
  platform: Platform | null
  scope: MemoryScope
  scope_ref: string | null
  confidence: number
  observation_count: number
}

// ---------------------------------------------------------------------------
// 16. campaign_briefs (ADR 0017 §2) — the brief artifact, brief-first Mode 2
// ---------------------------------------------------------------------------

export type CampaignBriefStatus = 'draft' | 'critiqued' | 'approved' | 'generated'

// Session 24-D (NIT-3) — chose to KEEP this bare alias rather than inline
// PostRole at its two use sites: the campaign post-role vocabulary (ADR 0017
// §3.2, build-guide L-5) as it appears inside a brief's roleSequence is
// identical in VALUE SET to PostRow.role's PostRole, but the two are named
// distinctly on purpose — L-5 is explicit that post ROLES are a field
// assigned at the brief stage, a deliberately separate concept from the
// generated post's own role column, even though today they share one
// underlying string union. The alias documents that intent; inlining
// PostRole would erase the distinction the ADR draws, for a false
// "simplification."
export type CampaignPostRole = PostRole

// ADR 0017 §2.2 — the campaign_briefs.content JSONB shape. Named (never
// Record<string, unknown>, [db-NIT-1]) so the brief-assembly/critique/
// generation pipeline (B2.2+) has a single typed contract for the brief's
// argument, pinned evidence, and role sequence.
export type CampaignBriefContent = {
  narrative: string
  proofPlan: string
  // Citation-by-id, not inlined text (ADR §2.2, §9 [sec-MEDIUM-1]): evidence
  // bytes are re-fetched and guarded at render time.
  pinnedEvidence: Array<{ evidenceMemoryId: string; note?: string }>
  roleSequence: Array<{ order: number; role: CampaignPostRole; platform: Platform; angle: string }>
}

export type CampaignBriefRow = {
  id: string
  business_id: string
  campaign_id: string
  content: CampaignBriefContent
  status: CampaignBriefStatus
  version: number
  overall_score: number | null
  // Latest rubric critique payload (ADR §6.2). Open-shape until B2.5 defines
  // RubricOutput in lib/ai/prompts/rubric.ts — tightened there, not here.
  critique: Record<string, unknown> | null
  frozen_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type CampaignBriefInsert = {
  id?: string
  business_id: string
  campaign_id: string
  content: CampaignBriefContent
  status?: CampaignBriefStatus
  version?: number
  overall_score?: number | null
  critique?: Record<string, unknown> | null
  frozen_at?: string | null
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

// Tenancy-critical + lifecycle-managed fields excluded, mirroring
// CampaignUpdate (lib/db/types.ts:257): id/created_at/business_id/
// campaign_id/deleted_at are never mutated through a generic update — status/
// version/frozen_at are exclusively written through campaign-briefs.ts's four
// atomic transition helpers, never a raw .update() call.
export type CampaignBriefUpdate = Partial<
  Omit<CampaignBriefRow, 'id' | 'created_at' | 'business_id' | 'campaign_id' | 'deleted_at'>
>

// ---------------------------------------------------------------------------
// 17. post_ai_originals / post_edit_signals (ADR 0018 §2.3/§3.3) — Session 25
// C2.2. post_ai_originals is immutable (write-once trigger, no updated_at);
// post_edit_signals is the durable outbox row per (post, ai_original) pending
// Tier-0/Tier-1 distillation. PostUpdate (lib/db/types.ts:320) is NOT changed
// by this addition — stated explicitly per ADR §2.6, so no speculative Omit
// is added there.
// ---------------------------------------------------------------------------

export type PostAiOriginalGenerationKind = 'initial' | 'regeneration'
export type PostAiOriginalFormat = 'single' | 'thread'

export type PostAiOriginalRow = {
  id: string
  business_id: string
  post_id: string
  campaign_id: string
  revision: number
  generation_kind: PostAiOriginalGenerationKind
  format: PostAiOriginalFormat
  payload: Record<string, unknown>
  rendered_content: string
  hashtags: string[]
  schema_version: number
  created_at: string
}

export type PostAiOriginalInsert = {
  id?: string
  business_id: string
  post_id: string
  campaign_id: string
  revision?: number
  generation_kind: PostAiOriginalGenerationKind
  format: PostAiOriginalFormat
  payload: Record<string, unknown>
  rendered_content: string
  hashtags?: string[]
  schema_version: number
  created_at?: string
}

export type PostEditSignalStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'abandoned'
export type PostEditSignalClass = 'preference' | 'correction' | 'inconclusive'

export type PostEditSignalRow = {
  id: string
  business_id: string
  post_id: string
  campaign_id: string
  ai_original_id: string
  human_content: string
  human_hashtags: string[]
  approved_at: string
  status: PostEditSignalStatus
  attempts: number
  next_attempt_at: string
  last_error: string | null
  processed_at: string | null
  class: PostEditSignalClass | null
  pattern_key: string | null
  signals: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type PostEditSignalInsert = {
  id?: string
  business_id: string
  post_id: string
  campaign_id: string
  ai_original_id: string
  human_content: string
  human_hashtags?: string[]
  approved_at: string
  status?: PostEditSignalStatus
  attempts?: number
  next_attempt_at?: string
  last_error?: string | null
  processed_at?: string | null
  class?: PostEditSignalClass | null
  pattern_key?: string | null
  signals?: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
}
