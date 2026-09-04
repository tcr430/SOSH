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

// ADR 0020 §7.3 — UntrustedText, on signals.title / signals.body. Minted
// ONLY by E2.5's ingestion parser (on write) and by lib/db/signals.ts's
// query functions (on read, where "the brand originates at the data-access
// boundary" per §7.4 — Supabase returns plain JSON with no brand, so a read
// function casts at the point it hands the row back to its caller).
//
// A non-exported `unique symbol` brand key, not a string-literal one
// (`_brand: 'UntrustedText'`) — the ADR 0019 §8.4 precedent
// (lib/studio/verify.ts:120's `verified` symbol). A `unique symbol` is
// globally unique by construction: no other module can accidentally define
// a structurally-identical brand by reusing the same string literal, which
// is exactly the collision a string-literal brand does not prevent.
//
// THE HONEST LIMIT (stated here, not only in the ADR — reviewers caught
// this exact overclaim TWICE in prior sessions, ADR 0019 §8.4 records both):
// this is "discouraged", NOT "unrepresentable". `string & brand` is
// assignable to any `string` parameter and — decisively — to any
// template-literal hole: `` `Context:\n${signal.body}` `` compiles with NO
// error, brand or no brand. A bare `as UntrustedText` cast likewise remains
// compile-legal. Nothing below closes that; it is closed by E2.10's
// executable source scans (ADR §11.3 scan #4), not by a stronger type. Do
// not restate this guarantee more strongly than the ADR does.
const untrustedTextBrand: unique symbol = Symbol('signals-untrusted-text')
export type UntrustedText = string & { readonly [untrustedTextBrand]: true }

// ---------------------------------------------------------------------------
// Shared enum types
// ---------------------------------------------------------------------------

export type Plan = 'trial' | 'plus' | 'pro' | 'agency'
export type Language = 'en' | 'pt' | 'es'
export type Platform = 'linkedin' | 'twitter' | 'instagram' | 'facebook' | 'threads'
export type CampaignFrequency = 'daily' | '3x_week' | 'weekly' | 'custom'
export type CampaignStatus = 'draft' | 'awaiting_brief' | 'active' | 'paused' | 'completed'
// Fourth value 'studio_promoted' (ADR 0017 Amd B, ADR 0022 §2.3, F1b.1) —
// a campaign created via Studio "promote-to-campaign", distinct from a
// hand-typed manual campaign so provenance stays truthful in listCampaigns,
// the learning loop, and any future analysis.
export type CampaignOrigin = 'manual' | 'objective_generated' | 'signal_generated' | 'studio_promoted'
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
  // Publish identity (ADR 0028 §9.2, N2.4). NULL for rows created before this
  // column existed and for any row not yet resolved to a specific connected
  // account. FK -> social_accounts(id) ON DELETE SET NULL — disconnecting an
  // account must never delete published history. No backfill: existing
  // platform_user_id values are Postiz integrationIds, meaningless to the
  // native LinkedIn/X providers (D-gamma). Excluded from PostUpdate below —
  // publish-identity resolution (N2.5) is a service-role concern, not an
  // app-layer authenticated write.
  social_account_id: string | null
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
  // See PostRow.social_account_id above (ADR 0028 §9.2, N2.4).
  social_account_id?: string | null
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

export type PostUpdate = Partial<Omit<PostRow, 'id' | 'created_at' | 'business_id' | 'campaign_id' | 'published_at' | 'platform_post_id' | 'platform_url' | 'deleted_at' | 'role' | 'social_account_id'>>

// ---------------------------------------------------------------------------
// 5b. studio_drafts — Mode 1 Studio pre-campaign scratch content (ADR 0019 §2.2)
// ---------------------------------------------------------------------------

export type StudioDraftRow = {
  id: string
  business_id: string
  content: string
  // Nullable, unlike PostRow['platform'] — a draft has no target platform
  // until the author picks one ([db-MINOR-1]).
  platform: Platform | null
  // Generated column (encode(sha256(content::bytea),'hex')) — read-only from
  // the app's perspective; never present on an Insert/Update payload.
  content_hash: string
  // A "suggestion set" (ADR 0019 §10/§11.1) — a JSON array, not a single
  // object; shape is owned by lib/studio's suggestion types, not this layer.
  suggestions: unknown[] | null
  suggestions_for_hash: string | null
  // Promote-to-campaign columns (ADR 0019 Amd A.1, ADR 0022 §3.1/§4.2, F1b.1).
  // All three NULL until a draft is promoted; promote claims atomically via a
  // conditional UPDATE guarded on promotion_claimed_at IS NULL (§3.1, F1b.3).
  promotion_claimed_at: string | null
  promoted_campaign_id: string | null
  // The accepted AI-generated revision, retained for the post_ai_originals
  // snapshot at promote time (§4.2). NULL when the draft was never
  // suggested-on (human-authored, no model baseline to snapshot).
  accepted_revision: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type StudioDraftInsert = {
  id?: string
  business_id: string
  content?: string
  platform?: Platform | null
  suggestions?: unknown[] | null
  suggestions_for_hash?: string | null
  promotion_claimed_at?: string | null
  promoted_campaign_id?: string | null
  accepted_revision?: string | null
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

// business_id excluded (tenancy-critical); content_hash excluded (generated,
// read-only on every write type — the DB computes it from content).
export type StudioDraftUpdate = Partial<Omit<StudioDraftRow, 'id' | 'created_at' | 'business_id' | 'content_hash'>>

// ---------------------------------------------------------------------------
// 5c. Signal ingestion — github_connections, watched_repos, signals,
//     signal_candidates (ADR 0020 §3). Written almost exclusively by the
//     poller's service-role client; connect/disconnect and watch-list edits
//     are the only authenticated-path writes (ADR 0020 §8).
// ---------------------------------------------------------------------------

// ADR 0023 §3.2 (Session 30 G1b.1) widened both CHECKs to add the
// market-responsive (rss) source — 'rss'/'article' pairs with
// watched_feed_id, exactly as 'github'/'release' pairs with
// watched_repo_id (the DB's exactly-one-parent CHECK enforces the pairing;
// this type does not).
export type SignalSource = 'github' | 'rss'
export type SignalKind = 'release' | 'article'
export type SignalIngestedVia = 'poll' | 'webhook'
// ADR 0021 §2.11 (Session 28 E5.2) widened the DB CHECK to all five values —
// this type was missed at E5.2 and only carried 'new' until E5.6 caught it.
// terminal: carded, no_card, triage_failed. non-terminal (upsert_signal_
// candidate restarts these): new, triaging.
export type SignalCandidateStatus = 'new' | 'triaging' | 'carded' | 'no_card' | 'triage_failed'

export type GithubConnectionRow = {
  id: string
  business_id: string
  installation_id: number
  account_login: string
  is_active: boolean
  connected_by: string | null
  connected_at: string
  last_poll_started_at: string | null
  last_poll_completed_at: string | null
  last_poll_status: string | null
  rate_limited_until: string | null
  created_at: string
  updated_at: string
}

export type GithubConnectionInsert = {
  id?: string
  business_id: string
  installation_id: number
  account_login: string
  is_active?: boolean
  connected_by?: string | null
  connected_at?: string
  last_poll_started_at?: string | null
  last_poll_completed_at?: string | null
  last_poll_status?: string | null
  rate_limited_until?: string | null
  created_at?: string
  updated_at?: string
}

// business_id excluded (tenancy-critical).
export type GithubConnectionUpdate = Partial<Omit<GithubConnectionRow, 'id' | 'created_at' | 'business_id'>>

export type WatchedRepoRow = {
  id: string
  business_id: string
  connection_id: string
  // GitHub's immutable numeric repo id — not owner/name, which can rename.
  repo_id: number
  owner: string
  name: string
  is_active: boolean
  releases_etag: string | null
  last_polled_at: string | null
  weight: number
  added_by: string | null
  created_at: string
  updated_at: string
}

export type WatchedRepoInsert = {
  id?: string
  business_id: string
  connection_id: string
  repo_id: number
  owner: string
  name: string
  is_active?: boolean
  releases_etag?: string | null
  last_polled_at?: string | null
  weight?: number
  added_by?: string | null
  created_at?: string
  updated_at?: string
}

// business_id excluded (tenancy-critical).
export type WatchedRepoUpdate = Partial<Omit<WatchedRepoRow, 'id' | 'created_at' | 'business_id'>>

// ADR 0023 §3.2/§8.2 — parallel in shape to WatchedRepoRow above.
export type WatchedFeedRow = {
  id: string
  business_id: string
  url: string
  // App-computed (§3.2) — normalized, then hashed. See the migration's
  // comment on why this is not a generated column.
  url_hash: string
  label: string
  is_active: boolean
  weight: number
  added_by: string | null
  last_fetch_at: string | null
  last_fetch_status: string | null
  last_error_code: string | null
  consecutive_failure_count: number
  rate_limited_until: string | null
  // ADR 0023 §3.1/§9.4 (Session 30 G1b.5) — the conditional-GET cursor,
  // mirroring watched_repos.releases_etag. Added after G1b.1's original
  // migration: G1b.4 built If-None-Match support with nowhere to persist
  // its value across ticks until this column existed.
  etag: string | null
  // ADR 0023 §8.4/§9.4 (Session 30 G1b.9) — set only on an 'ok'/'not_modified'
  // outcome (recordWatchedFeedPollOutcome), left untouched on 'error'. Unlike
  // last_fetch_at (which updates on EVERY outcome), this is the timestamp
  // the config surface's "fetch-failing" state needs to show a last-success
  // time across a run of consecutive failures.
  last_success_at: string | null
  created_at: string
  updated_at: string
}

export type WatchedFeedInsert = {
  id?: string
  business_id: string
  url: string
  url_hash: string
  label: string
  is_active?: boolean
  weight?: number
  added_by?: string | null
  last_fetch_at?: string | null
  last_fetch_status?: string | null
  last_error_code?: string | null
  consecutive_failure_count?: number
  rate_limited_until?: string | null
  etag?: string | null
  last_success_at?: string | null
  created_at?: string
  updated_at?: string
}

// business_id excluded (tenancy-critical).
export type WatchedFeedUpdate = Partial<Omit<WatchedFeedRow, 'id' | 'created_at' | 'business_id'>>

export type SignalRow = {
  id: string
  business_id: string
  // ADR 0023 §3.2 — exactly one of watched_repo_id / watched_feed_id is
  // non-null, matching `source` ('github' <-> watched_repo_id, 'rss' <->
  // watched_feed_id). Enforced by the DB's exactly-one-parent CHECK, not by
  // this type.
  watched_repo_id: string | null
  watched_feed_id: string | null
  source: SignalSource
  kind: SignalKind
  external_id: string
  // ADR 0020 §7.3/§7.4 — branded, not plain string. Third-party-authored
  // GitHub release text, never sanitized at ingest (§7.2 — fidelity is the
  // point; sanitizing at rest would corrupt what a human reviewer must read
  // in Session 28's card). Reaches a prompt only through
  // wrapSignalForPrompt(): RenderedSignalText (lib/ai/wrap-evidence.ts).
  title: UntrustedText
  body: UntrustedText
  body_truncated: boolean
  html_url: string | null
  occurred_at: string
  is_prerelease: boolean
  author_is_bot: boolean
  ingested_via: SignalIngestedVia
  // Generated column — read-only, never present on an Insert/Update payload.
  content_hash: string
  created_at: string
  updated_at: string
}

// ⚠️ STRUCTURAL, not a runtime filter (ADR 0020 §5.3): this type has no
// author.login / author.id / author.avatar_url / author.html_url /
// author_association / assets / reactions / mentions_count / tarball_url /
// zipball_url fields at all. The parser cannot forget to drop them — they
// have nowhere to go.
export type SignalInsert = {
  id?: string
  business_id: string
  // ADR 0023 §3.2 — caller supplies exactly one, matching `source`; the DB
  // CHECK is the actual arbiter.
  watched_repo_id?: string | null
  watched_feed_id?: string | null
  source: SignalSource
  kind: SignalKind
  external_id: string
  // ADR 0020 §7.3 sink narrowing: the ingestion parser must already hold an
  // UntrustedText value (via its own mint) before it can build this Insert
  // — a plain string is rejected here without a cast.
  title: UntrustedText
  body?: UntrustedText
  body_truncated?: boolean
  html_url?: string | null
  occurred_at: string
  is_prerelease?: boolean
  author_is_bot?: boolean
  ingested_via?: SignalIngestedVia
  created_at?: string
  updated_at?: string
}

// business_id, watched_repo_id, watched_feed_id, external_id, created_at
// excluded — the BEFORE UPDATE trigger (guard_signals_identity_update)
// raises on any of these regardless (watched_feed_id joining the guard as
// the fifth immutable column, ADR 0023 §3.2), so excluding them here is the
// app-layer echo of that DB boundary. content_hash excluded (generated,
// read-only).
export type SignalUpdate = Partial<
  Omit<SignalRow, 'id' | 'created_at' | 'business_id' | 'watched_repo_id' | 'watched_feed_id' | 'external_id' | 'content_hash'>
>

export type SignalCandidateRow = {
  id: string
  business_id: string
  signal_id: string
  score: number
  score_inputs: Record<string, unknown>
  // Denormalised from signals.occurred_at ([db-MAJOR-C]) — Postgres cannot
  // index across two tables and the feed's ORDER BY spans both.
  occurred_at: string
  status: SignalCandidateStatus
  // ADR 0021 §2.9 (Session 28 E5.2) — also missed at E5.2, caught alongside
  // SignalCandidateStatus's widening at E5.6. NULL except while status is
  // 'triaging'.
  triage_claimed_at: string | null
  created_at: string
  updated_at: string
}

// type-design-analyzer (E2.4 pass) — lib/db/signal-candidates.ts's
// listNewCandidates() joins `signals(title, body, html_url, occurred_at,
// author_is_bot)` onto every row (ADR §13.1's join list, minus tag_name —
// see that file's comment). SignalCandidateRow alone has no field for that
// joined data, so casting a join result to SignalCandidateRow silently
// erases it — and erases the UntrustedText brand along with it, leaving a
// future caller to reach for an unbranded `{ title: string, ... }` shape by
// hand. This type is the SECOND read boundary (after lib/db/signals.ts's
// asSignalRow) that mints UntrustedText out of raw Postgres JSON, declared
// explicitly rather than left to whoever writes Session 28's consumer.
export type SignalCandidateWithSignal = SignalCandidateRow & {
  signals: {
    title: UntrustedText
    body: UntrustedText
    html_url: string | null
    occurred_at: string
    author_is_bot: boolean
    // Session 28 E5.7 — added alongside the join widening in
    // lib/db/signal-candidates.ts (ADR §4.4's sensitivity rule needs it).
    is_prerelease: boolean
  }
}

export type SignalCandidateInsert = {
  id?: string
  business_id: string
  signal_id: string
  score: number
  score_inputs?: Record<string, unknown>
  occurred_at: string
  status?: SignalCandidateStatus
  created_at?: string
  updated_at?: string
}

// business_id, signal_id excluded (tenancy-critical / the upsert arbiter).
export type SignalCandidateUpdate = Partial<Omit<SignalCandidateRow, 'id' | 'created_at' | 'business_id' | 'signal_id'>>

// ---------------------------------------------------------------------------
// insight_cards / signal_triage_budget — ADR 0021 §4.1, §8 (Session 28 E5.1)
// ---------------------------------------------------------------------------

// §5.3's state machine: pending -> approved | dismissed | saved;
// saved -> approved | dismissed. Enforced in the DB by
// enforce_insight_card_legal_transition (BEFORE UPDATE trigger), not by this
// type alone — this is the app-layer echo of that DB boundary.
export type InsightCardStatus = 'pending' | 'approved' | 'dismissed' | 'saved'

// The closed five of §5.4.
export type InsightCardDismissReason =
  | 'not_relevant'
  | 'already_covered'
  | 'too_sensitive'
  | 'wrong_timing'
  | 'weak_evidence'

export type InsightCardAngleOption = {
  angle: string
  rationale: string
}

export type InsightCardRow = {
  id: string
  business_id: string
  signal_candidate_id: string
  observation: string
  why_it_matters: string
  audience: string
  angle_options: InsightCardAngleOption[]
  // The verified evidence-memory id set (§4.6) — a jsonb id array, no FK.
  evidence: string[]
  suggested_objective: string | null
  novelty: number
  freshness: number
  sensitivity: number
  confidence: number
  rubric_scores: Record<string, unknown>
  // Denormalised from signal_candidates.score/occurred_at ([db-MAJOR-C]
  // precedent) — Postgres cannot index across two tables and the feed's
  // ORDER BY (§5.7) spans both.
  score: number
  occurred_at: string
  status: InsightCardStatus
  dismiss_reason: InsightCardDismissReason | null
  expires_at: string | null
  // §9.2/§6.4 (Session 28-D, D7, MINOR-7) — Stage F's write-back
  // (seedCampaignFromCard, service-role only) links an approved card to the
  // campaign it seeded. NULL for every pre-migration row and for the brief
  // window between an approve transition and the write-back landing — both
  // render the existing inert fallback (OpportunityFeed.tsx), never an
  // error.
  campaign_id: string | null
  created_at: string
  updated_at: string
}

// ADR 0023 §6.5 (Session 30 G1b.8) — SIGNAL-MR-PROVENANCE-VISIBLE. Reachable
// TODAY through the existing two-hop join (insight_cards.signal_candidate_id
// -> signal_candidates.signal_id -> signals.html_url) — NO denormalised
// column on insight_cards itself, matching §5.3's refusal of the same move
// for `source`. publisher is DERIVED from canonicalLink's hostname at query
// time (lib/db/insight-cards.ts), not a separately stored value — this
// works identically for both sources (a GitHub release's canonical link
// hosts at github.com; an RSS article's at whatever domain the customer
// subscribed to), which is exactly the domain-trust signal the human
// approval gate needs to see. Computed server-side, NEVER threaded through
// any prompt (§6.3).
export interface CardProvenance {
  publisher: string | null
  canonicalLink: string | null
}

export type InsightCardWithProvenance = InsightCardRow & { provenance: CardProvenance }

export type InsightCardInsert = {
  id?: string
  business_id: string
  signal_candidate_id: string
  observation: string
  why_it_matters: string
  audience: string
  angle_options: InsightCardAngleOption[]
  evidence: string[]
  suggested_objective?: string | null
  novelty: number
  freshness: number
  sensitivity: number
  confidence: number
  rubric_scores: Record<string, unknown>
  score: number
  occurred_at: string
  status?: InsightCardStatus
  dismiss_reason?: InsightCardDismissReason | null
  expires_at?: string | null
  created_at?: string
  updated_at?: string
}

// business_id, signal_candidate_id excluded (tenancy-critical / the upsert
// arbiter). score, occurred_at excluded — denormalised at insert only, never
// touched by a triage transition. Every other Stage-D-authored field
// excluded too: a triage UPDATE (the only authenticated write path, §5.3)
// only ever changes status/dismiss_reason/expires_at.
export type InsightCardUpdate = Partial<
  Pick<InsightCardRow, 'status' | 'dismiss_reason' | 'expires_at'>
>

export type SignalTriageBudgetRow = {
  id: string
  business_id: string
  day: string
  reserved_cents: number
  created_at: string
  updated_at: string
}

export type SignalTriageBudgetInsert = {
  id?: string
  business_id: string
  day: string
  reserved_cents?: number
  created_at?: string
  updated_at?: string
}

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

// Third value 'studio_promoted' (ADR 0018 Amd A.1, F1b.2/F1b.4) — the
// post_ai_originals snapshot promote writes from studio_drafts.accepted_revision
// (the accepted AI suggestion, never the human's raw draft) when a genuine
// model-generated baseline exists.
export type PostAiOriginalGenerationKind = 'initial' | 'regeneration' | 'studio_promoted'
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
