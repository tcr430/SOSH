/**
 * TypeScript types for all 9 SŌSH database tables.
 *
 * Conventions:
 * - Row    — exact DB representation; matches every column including nulls.
 * - Insert — fields with DB defaults are optional; required fields stay required.
 * - Update — all fields optional (use with .eq('id', …).update(…)).
 * - Enum types are string literal unions, never TypeScript enums.
 * - Timestamps are string (ISO-8601); localisation is done in the app via date-fns.
 * - JSONB columns are Record<string, unknown> where the shape is open.
 */

// ---------------------------------------------------------------------------
// Shared utility types
// ---------------------------------------------------------------------------

// Branded type for Supabase Vault secret IDs. Prevents accidentally passing
// a plain string where a vault UUID is required.
export type VaultSecretId = string & { readonly _brand: 'VaultSecretId' }

// ---------------------------------------------------------------------------
// Shared enum types
// ---------------------------------------------------------------------------

export type Plan = 'trial' | 'starter' | 'pro' | 'agency'
export type Language = 'en' | 'pt' | 'es'
export type Platform = 'linkedin' | 'twitter' | 'instagram' | 'facebook' | 'threads'
export type CampaignFrequency = 'daily' | '3x_week' | 'weekly' | 'custom'
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed'
export type PostStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'failed' | 'skipped'
export type EngagementType = 'comment' | 'dm' | 'mention'
export type EngagementSentiment = 'positive' | 'neutral' | 'negative' | 'urgent'
export type EngagementStatus = 'pending' | 'replied' | 'ignored' | 'auto_replied'

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

export type SocialAccountUpdate = Partial<Omit<SocialAccountRow, 'id' | 'created_at'>>

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
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

export type CampaignUpdate = Partial<Omit<CampaignRow, 'id' | 'created_at' | 'deleted_at'>>

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
  status: PostStatus
  rejection_note: string | null
  ai_generation_metadata: Record<string, unknown>
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
  hashtags?: string[]
  media_urls?: string[]
  scheduled_at: string
  published_at?: string | null
  platform_post_id?: string | null
  status?: PostStatus
  rejection_note?: string | null
  ai_generation_metadata?: Record<string, unknown>
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
}

export type PostUpdate = Partial<Omit<PostRow, 'id' | 'created_at' | 'business_id' | 'campaign_id' | 'published_at' | 'platform_post_id' | 'deleted_at'>>

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
