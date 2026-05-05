/**
 * Type-level tests for /lib/db/types.ts.
 *
 * No runtime test framework. Correctness is verified by `tsc --noEmit`:
 *   - Lines WITHOUT @ts-expect-error must compile.
 *   - Lines WITH @ts-expect-error must fail (otherwise tsc reports an unused
 *     suppress directive, which is also an error under strict mode).
 *
 * All negative-test satisfies expressions are on a single line so that
 * @ts-expect-error (which suppresses only the next line) aligns correctly.
 */

import type {
  VaultSecretId,
  Plan,
  Language,
  Platform,
  CampaignFrequency,
  CampaignStatus,
  PostStatus,
  EngagementType,
  EngagementSentiment,
  EngagementStatus,
  BusinessRow,
  BusinessInsert,
  BusinessUpdate,
  BrandVoiceRow,
  BrandVoiceInsert,
  BrandVoiceUpdate,
  SocialAccountRow,
  SocialAccountInsert,
  SocialAccountUpdate,
  CampaignRow,
  CampaignInsert,
  CampaignUpdate,
  PostRow,
  PostInsert,
  PostUpdate,
  PostMetricsRow,
  PostMetricsInsert,
  PostMetricsUpdate,
  EngagementInboxRow,
  EngagementInboxInsert,
  EngagementInboxUpdate,
  TrialStateRow,
  TrialStateInsert,
  TrialStateUpdate,
  AiUsageRow,
  AiUsageInsert,
} from './types'

// ---------------------------------------------------------------------------
// Type utilities
// ---------------------------------------------------------------------------

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

// ---------------------------------------------------------------------------
// Enum union types
// ---------------------------------------------------------------------------

type _PlanValues = Assert<Equals<Plan, 'trial' | 'starter' | 'pro' | 'agency'>>
type _LanguageValues = Assert<Equals<Language, 'en' | 'pt' | 'es'>>
type _PlatformValues = Assert<Equals<Platform, 'linkedin' | 'twitter' | 'instagram' | 'facebook' | 'threads'>>
type _FrequencyValues = Assert<Equals<CampaignFrequency, 'daily' | '3x_week' | 'weekly' | 'custom'>>
type _CampaignStatusValues = Assert<Equals<CampaignStatus, 'draft' | 'active' | 'paused' | 'completed'>>
type _PostStatusValues = Assert<Equals<PostStatus, 'draft' | 'approved' | 'scheduled' | 'published' | 'failed' | 'skipped'>>
type _EngagementTypeValues = Assert<Equals<EngagementType, 'comment' | 'dm' | 'mention'>>
type _SentimentValues = Assert<Equals<EngagementSentiment, 'positive' | 'neutral' | 'negative' | 'urgent'>>
type _EngagementStatusValues = Assert<Equals<EngagementStatus, 'pending' | 'replied' | 'ignored' | 'auto_replied'>>

// ---------------------------------------------------------------------------
// 1. businesses
// ---------------------------------------------------------------------------

type _BusinessRowPlan = Assert<Equals<BusinessRow['plan'], Plan>>
type _BusinessRowNullables = Assert<Equals<BusinessRow['website'], string | null>>
type _BusinessRowStripe = Assert<Equals<BusinessRow['stripe_customer_id'], string | null>>
type _BusinessRowDeletedAt = Assert<Equals<BusinessRow['deleted_at'], string | null>>

// Positive: minimal and full inserts compile
const _businessInsertMinimal = { name: 'Acme', owner_id: 'uuid-abc' } satisfies BusinessInsert
const _businessInsertFull = { name: 'Acme', owner_id: 'uuid-abc', plan: 'starter' as Plan, language: 'pt' as Language, timezone: 'Europe/Lisbon', onboarding_completed: true } satisfies BusinessInsert

// Negative: invalid enum value
// @ts-expect-error — 'free' is not a valid Plan
const _businessInsertBadPlan = { name: 'X', owner_id: 'y', plan: 'free' } satisfies BusinessInsert

// Negative: missing required fields
// @ts-expect-error — name is required
const _businessInsertMissingName = { owner_id: 'uuid' } satisfies BusinessInsert
// @ts-expect-error — owner_id is required
const _businessInsertMissingOwner = { name: 'Acme' } satisfies BusinessInsert

// Update: fully optional
const _businessUpdatePartial = { name: 'New Name' } satisfies BusinessUpdate
const _businessUpdateEmpty = {} satisfies BusinessUpdate

// ---------------------------------------------------------------------------
// 2. brand_voices
// ---------------------------------------------------------------------------

type _BrandVoiceArrayFields = Assert<Equals<BrandVoiceRow['tone'], string[]>>
type _BrandVoiceNullable = Assert<Equals<BrandVoiceRow['target_audience'], string | null>>

// Positive: business_id is the only required field
const _brandVoiceInsertMinimal = { business_id: 'uuid' } satisfies BrandVoiceInsert
const _brandVoiceInsertFull = { business_id: 'uuid', tone: ['professional'], keywords: ['SaaS', 'B2B'] } satisfies BrandVoiceInsert

// Negative: business_id missing
// @ts-expect-error — business_id is required
const _brandVoiceInsertMissing = {} satisfies BrandVoiceInsert

const _brandVoiceUpdateEmpty = {} satisfies BrandVoiceUpdate

// ---------------------------------------------------------------------------
// 3. social_accounts
// ---------------------------------------------------------------------------

type _SocialAccountVaultAccess = Assert<Equals<SocialAccountRow['vault_access_token_id'], VaultSecretId>>
type _SocialAccountVaultRefresh = Assert<Equals<SocialAccountRow['vault_refresh_token_id'], VaultSecretId | null>>
type _SocialAccountPlatform = Assert<Equals<SocialAccountRow['platform'], Platform>>

// Positive
const _socialAccountInsertMinimal = {
  business_id: 'uuid',
  platform: 'linkedin' as Platform,
  platform_user_id: 'li-123',
  platform_username: 'acme',
  vault_access_token_id: 'vault-uuid' as VaultSecretId,
} satisfies SocialAccountInsert

// Negative: vault_access_token_id missing (single-line so @ts-expect-error aligns)
// @ts-expect-error — vault_access_token_id is required
const _socialAccountMissingVault = { business_id: 'uuid', platform: 'linkedin' as Platform, platform_user_id: 'li-123', platform_username: 'acme' } satisfies SocialAccountInsert

// Negative: 'reddit' is not a valid platform
// @ts-expect-error — 'reddit' is not a valid Platform
const _socialAccountBadPlatform = { business_id: 'uuid', platform: 'reddit', platform_user_id: 'r-123', platform_username: 'acme', vault_access_token_id: 'vault-uuid' as VaultSecretId } satisfies SocialAccountInsert

const _socialAccountUpdateEmpty = {} satisfies SocialAccountUpdate

// ---------------------------------------------------------------------------
// 4. campaigns
// ---------------------------------------------------------------------------

type _CampaignPlatforms = Assert<Equals<CampaignRow['platforms'], Platform[]>>
type _CampaignFrequency = Assert<Equals<CampaignRow['frequency'], CampaignFrequency>>
type _CampaignStatus = Assert<Equals<CampaignRow['status'], CampaignStatus>>
type _CampaignEndDate = Assert<Equals<CampaignRow['end_date'], string | null>>

// Positive
const _campaignInsertMinimal = {
  business_id: 'uuid',
  name: 'Q3 Launch',
  objective: 'Drive signups',
  platforms: ['linkedin' as Platform],
  frequency: 'weekly' as CampaignFrequency,
  posts_per_week: 3,
  start_date: '2026-06-01',
} satisfies CampaignInsert

// Negative: missing required fields (single-line)
// @ts-expect-error — business_id is required
const _campaignMissingBusiness = { name: 'Q3', objective: 'X', platforms: ['linkedin' as Platform], frequency: 'weekly' as CampaignFrequency, posts_per_week: 3, start_date: '2026-06-01' } satisfies CampaignInsert
// @ts-expect-error — platforms is required
const _campaignMissingPlatforms = { business_id: 'uuid', name: 'Q3', objective: 'X', frequency: 'weekly' as CampaignFrequency, posts_per_week: 3, start_date: '2026-06-01' } satisfies CampaignInsert

const _campaignUpdateEmpty = {} satisfies CampaignUpdate

// ---------------------------------------------------------------------------
// 5. posts — flat model, no post_variants
// ---------------------------------------------------------------------------

type _PostStatus = Assert<Equals<PostRow['status'], PostStatus>>
type _PostPlatform = Assert<Equals<PostRow['platform'], Platform>>
type _PostHashtags = Assert<Equals<PostRow['hashtags'], string[]>>
type _PostMetadata = Assert<Equals<PostRow['ai_generation_metadata'], Record<string, unknown>>>
type _PostDeletedAt = Assert<Equals<PostRow['deleted_at'], string | null>>

// Positive
const _postInsertMinimal = {
  campaign_id: 'uuid',
  business_id: 'uuid',
  platform: 'twitter' as Platform,
  content: 'Hello world',
  scheduled_at: '2026-06-01T09:00:00Z',
} satisfies PostInsert

// Negative: missing required fields (single-line)
// @ts-expect-error — content is required
const _postMissingContent = { campaign_id: 'uuid', business_id: 'uuid', platform: 'twitter' as Platform, scheduled_at: '2026-06-01T09:00:00Z' } satisfies PostInsert
// @ts-expect-error — scheduled_at is required
const _postMissingScheduledAt = { campaign_id: 'uuid', business_id: 'uuid', platform: 'twitter' as Platform, content: 'Hello' } satisfies PostInsert

// Update: fully optional
const _postUpdatePartial = { content: 'Updated text' } satisfies PostUpdate
const _postUpdateStatus = { status: 'approved' as PostStatus } satisfies PostUpdate
const _postUpdateEmpty = {} satisfies PostUpdate

// ---------------------------------------------------------------------------
// 6. post_metrics — upsert-in-place; all metric columns nullable
// ---------------------------------------------------------------------------

type _PostMetricsLikes = Assert<Equals<PostMetricsRow['likes'], number | null>>
type _PostMetricsImpressions = Assert<Equals<PostMetricsRow['impressions'], number | null>>

// Positive
const _postMetricsInsertMinimal = { post_id: 'uuid', business_id: 'uuid' } satisfies PostMetricsInsert
const _postMetricsInsertWithData = { post_id: 'uuid', business_id: 'uuid', likes: 42, impressions: 1500 } satisfies PostMetricsInsert

// Negative: post_id missing
// @ts-expect-error — post_id is required
const _postMetricsMissingPostId = { business_id: 'uuid' } satisfies PostMetricsInsert

const _postMetricsUpdateEmpty = {} satisfies PostMetricsUpdate

// ---------------------------------------------------------------------------
// 7. engagement_inbox
// ---------------------------------------------------------------------------

type _EngagementType = Assert<Equals<EngagementInboxRow['type'], EngagementType>>
type _EngagementSentiment = Assert<Equals<EngagementInboxRow['sentiment'], EngagementSentiment | null>>
type _EngagementStatus = Assert<Equals<EngagementInboxRow['status'], EngagementStatus>>
type _EngagementPostId = Assert<Equals<EngagementInboxRow['post_id'], string | null>>

// Positive
const _engagementInsertMinimal = {
  business_id: 'uuid',
  platform: 'instagram' as Platform,
  type: 'comment' as EngagementType,
  platform_item_id: 'ig-comment-123',
  author_username: 'acmefan',
  content: 'Great post!',
  received_at: '2026-06-01T10:00:00Z',
} satisfies EngagementInboxInsert

// Negative: type missing (single-line)
// @ts-expect-error — type is required
const _engagementMissingType = { business_id: 'uuid', platform: 'instagram' as Platform, platform_item_id: 'ig-123', author_username: 'fan', content: 'Nice', received_at: '2026-06-01T10:00:00Z' } satisfies EngagementInboxInsert

// Negative: 'urgent' is a sentiment value, not a valid EngagementStatus
// @ts-expect-error — 'urgent' is EngagementSentiment, not EngagementStatus
const _engagementBadStatus = { business_id: 'uuid', platform: 'instagram' as Platform, type: 'comment' as EngagementType, platform_item_id: 'ig-123', author_username: 'fan', content: 'Nice', received_at: '2026-06-01T10:00:00Z', status: 'urgent' } satisfies EngagementInboxInsert

const _engagementUpdatePartial = { status: 'replied' as EngagementStatus } satisfies EngagementInboxUpdate
const _engagementUpdateEmpty = {} satisfies EngagementInboxUpdate

// ---------------------------------------------------------------------------
// 8. trial_state
// ---------------------------------------------------------------------------

type _TrialStartedAt = Assert<Equals<TrialStateRow['trial_started_at'], string | null>>
type _TrialWorkEmail = Assert<Equals<TrialStateRow['work_email_verified'], boolean>>

// Positive
const _trialInsertMinimal = { business_id: 'uuid' } satisfies TrialStateInsert

// Negative: business_id missing
// @ts-expect-error — business_id is required
const _trialInsertMissing = {} satisfies TrialStateInsert

const _trialUpdatePartial = { trial_started_at: '2026-06-01T00:00:00Z' } satisfies TrialStateUpdate
const _trialUpdateEmpty = {} satisfies TrialStateUpdate

// ---------------------------------------------------------------------------
// 9. ai_usage — append-only, no updated_at
// ---------------------------------------------------------------------------

type _AiUsageNoUpdatedAt = 'updated_at' extends keyof AiUsageRow ? never : true
type _AssertNoUpdatedAt = Assert<_AiUsageNoUpdatedAt>
type _AiUsageSuccess = Assert<Equals<AiUsageRow['success'], boolean>>
type _AiUsageErrorCode = Assert<Equals<AiUsageRow['error_code'], string | null>>
type _AiUsageCostCents = Assert<Equals<AiUsageRow['cost_cents'], number>>

// Positive
const _aiUsageInsertMinimal = {
  business_id: 'uuid',
  prompt_id: 'campaign.generate_posts',
  prompt_version: 1,
  model: 'claude-sonnet-4-6',
  input_tokens: 1500,
  output_tokens: 300,
  cost_cents: 4,
  latency_ms: 2100,
  success: true,
} satisfies AiUsageInsert

// Negative: success missing (single-line)
// @ts-expect-error — success is required (no DB default)
const _aiUsageMissingSuccess = { business_id: 'uuid', prompt_id: 'campaign.generate_posts', prompt_version: 1, model: 'claude-sonnet-4-6', input_tokens: 1500, output_tokens: 300, cost_cents: 4, latency_ms: 2100 } satisfies AiUsageInsert

// Negative: input_tokens missing (single-line)
// @ts-expect-error — input_tokens is required (no DB default)
const _aiUsageMissingTokens = { business_id: 'uuid', prompt_id: 'campaign.generate_posts', prompt_version: 1, model: 'claude-sonnet-4-6', output_tokens: 300, cost_cents: 4, latency_ms: 2100, success: true } satisfies AiUsageInsert

// ---------------------------------------------------------------------------
// Suppress unused-variable warnings for runtime values
// ---------------------------------------------------------------------------

void _businessInsertMinimal
void _businessInsertFull
void _businessUpdatePartial
void _businessUpdateEmpty
void _brandVoiceInsertMinimal
void _brandVoiceInsertFull
void _brandVoiceUpdateEmpty
void _socialAccountInsertMinimal
void _socialAccountUpdateEmpty
void _campaignInsertMinimal
void _campaignUpdateEmpty
void _postInsertMinimal
void _postUpdatePartial
void _postUpdateStatus
void _postUpdateEmpty
void _postMetricsInsertMinimal
void _postMetricsInsertWithData
void _postMetricsUpdateEmpty
void _engagementInsertMinimal
void _engagementUpdatePartial
void _engagementUpdateEmpty
void _trialInsertMinimal
void _trialUpdatePartial
void _trialUpdateEmpty
void _aiUsageInsertMinimal
