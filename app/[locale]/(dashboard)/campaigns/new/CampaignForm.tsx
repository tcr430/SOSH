'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { differenceInWeeks, formatISO, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { PLATFORM_CONFIGS, VALID_PLATFORMS, publishingAvailableFor } from '@/lib/social'
import { createCampaignAction } from './actions'
import type { Platform } from '@/lib/db/types'

type ConnectedAccount = { platform: Platform }

interface CampaignFormProps {
  connectedAccounts: ConnectedAccount[]
  locale: string
}

type FrequencyPreset = 'daily' | '3x_week' | 'weekly' | 'custom'

const FREQUENCY_PRESETS: { value: FrequencyPreset; posts: number | null }[] = [
  { value: 'daily', posts: 7 },
  { value: '3x_week', posts: 3 },
  { value: 'weekly', posts: 1 },
  { value: 'custom', posts: null },
]

const PLATFORM_ABBR: Record<Platform, string> = {
  linkedin: 'Li',
  twitter: 'X',
  instagram: 'Ig',
  facebook: 'Fb',
  threads: 'Th',
}

function todayISO(): string {
  return formatISO(new Date(), { representation: 'date' })
}

function estimatedPosts(postsPerWeek: number, start: string, end: string): number {
  if (!end) return postsPerWeek * 4
  try {
    const weeks = Math.max(1, differenceInWeeks(parseISO(end), parseISO(start)))
    return weeks * postsPerWeek
  } catch {
    return postsPerWeek * 4
  }
}

export function CampaignForm({ connectedAccounts, locale }: CampaignFormProps) {
  const t = useTranslations('campaigns.new')
  const tErrors = useTranslations('errors.campaign')
  const router = useRouter()

  const [state, formAction, isPending] = useActionState(createCampaignAction, {})

  const [name, setName] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([])
  const [frequency, setFrequency] = useState<FrequencyPreset>('3x_week')
  const [postsPerWeek, setPostsPerWeek] = useState(3)
  const [startDate, setStartDate] = useState(todayISO)
  const [endDate, setEndDate] = useState('')

  const today = todayISO()
  const connectedSet = new Set(connectedAccounts.map((a) => a.platform))
  const estimated = estimatedPosts(postsPerWeek, startDate, endDate)
  const isValid = name.trim().length >= 1 && selectedPlatforms.length >= 1

  useEffect(() => {
    if (state.success && state.campaignId) {
      router.push(`/${locale}/campaigns/${state.campaignId}`)
    }
  }, [state.success, state.campaignId, router, locale])

  function togglePlatform(platform: Platform) {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    )
  }

  function handleFrequencyChange(value: FrequencyPreset) {
    setFrequency(value)
    const preset = FREQUENCY_PRESETS.find((p) => p.value === value)
    if (preset?.posts != null) setPostsPerWeek(preset.posts)
  }

  return (
    <form action={formAction} className="pb-28">
      {/* Serialised state as hidden inputs */}
      <input type="hidden" name="frequency" value={frequency} />
      <input type="hidden" name="postsPerWeek" value={postsPerWeek} />
      <input type="hidden" name="startDate" value={startDate} />
      {endDate && <input type="hidden" name="endDate" value={endDate} />}
      {selectedPlatforms.map((p) => (
        <input key={p} type="hidden" name="platforms" value={p} />
      ))}

      <div className="space-y-12">
        {/* ── Section 1: Goal ── */}
        <section className="space-y-6">
          <SectionHeading>{t('section1.title')}</SectionHeading>

          <Field label={t('fields.name')} htmlFor="name" required error={state.errors?.name}>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('fields.name_placeholder')}
              className={inputClass}
            />
          </Field>

          <Field label={t('fields.objective')} htmlFor="objective" required error={state.errors?.objective}>
            <textarea
              id="objective"
              name="objective"
              required
              rows={4}
              maxLength={2000}
              placeholder={t('fields.objective_placeholder')}
              className={cn(inputClass, 'resize-none')}
            />
          </Field>

          <Field
            label={t('fields.special_instructions')}
            htmlFor="specialInstructions"
            optional={t('fields.optional')}
          >
            <textarea
              id="specialInstructions"
              name="specialInstructions"
              rows={3}
              maxLength={1000}
              placeholder={t('fields.special_instructions_placeholder')}
              className={cn(inputClass, 'resize-none')}
            />
          </Field>
        </section>

        {/* ── Section 2: Platforms & schedule ── */}
        <section className="space-y-6">
          <SectionHeading>{t('section2.title')}</SectionHeading>

          {/* Platform cards */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              {t('fields.platforms')} <span className="text-destructive">*</span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(VALID_PLATFORMS as readonly Platform[]).map((platform) => {
                const cfg = PLATFORM_CONFIGS[platform]
                const connected = connectedSet.has(platform)
                const publishing = publishingAvailableFor(platform)
                const selected = selectedPlatforms.includes(platform)

                if (!connected) {
                  return (
                    <div
                      key={platform}
                      className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-muted/20 p-3 opacity-55"
                    >
                      <span className="text-sm font-medium text-muted-foreground">
                        {cfg.displayName}
                      </span>
                      <Link
                        href={`/${locale}/settings/accounts`}
                        className="text-xs text-primary hover:underline"
                        tabIndex={-1}
                      >
                        {t('platform.not_connected')}
                      </Link>
                    </div>
                  )
                }

                return (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => togglePlatform(platform)}
                    className={cn(
                      'relative flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all',
                      selected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border bg-background hover:border-primary/40 hover:bg-muted/20',
                    )}
                  >
                    <span className="text-sm font-medium">{cfg.displayName}</span>
                    {!publishing && (
                      <span className="text-xs text-muted-foreground">
                        {t('platform.coming_soon')}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {state.errors?.platforms && (
              <p className="text-sm text-destructive">{state.errors.platforms}</p>
            )}
          </div>

          {/* Frequency */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t('fields.frequency_label')}</p>
            <div className="flex flex-wrap gap-2">
              {FREQUENCY_PRESETS.map(({ value }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleFrequencyChange(value)}
                  className={cn(
                    'rounded-full border px-4 py-1.5 text-sm font-medium transition-all',
                    frequency === value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:border-primary/50',
                  )}
                >
                  {t(`fields.frequency.${value}`)}
                </button>
              ))}
            </div>

            {frequency === 'custom' && (
              <div className="flex items-center gap-2 mt-3">
                <input
                  type="number"
                  min={1}
                  max={21}
                  value={postsPerWeek}
                  onChange={(e) =>
                    setPostsPerWeek(Math.max(1, Math.min(21, Number(e.target.value))))
                  }
                  className="w-20 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-sm text-muted-foreground">{t('fields.posts_per_week')}</span>
              </div>
            )}
          </div>

          {/* Date range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('fields.start_date')} htmlFor="startDate" required>
              <input
                id="startDate"
                type="date"
                min={today}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label={t('fields.end_date')} htmlFor="endDate" optional={t('fields.optional')} error={state.errors?.endDate}>
              <input
                id="endDate"
                type="date"
                min={startDate || today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          {endDate && (
            <p className="text-sm text-muted-foreground">
              {t('fields.estimated_posts', { count: estimated })}
            </p>
          )}
        </section>

        {/* Limit banners */}
        {state.errors?._limit === 'trial_campaign_limit' && (
          <LimitBanner>{t('limit.trial')}</LimitBanner>
        )}
        {state.errors?._limit === 'plus_campaign_limit' && (
          <LimitBanner>{t('limit.plus')}</LimitBanner>
        )}

        {/* Generic error */}
        {state.errors?._form && (
          <p className="text-sm text-destructive">{tErrors('generic')}</p>
        )}
      </div>

      {/* ── Section 3: Sticky summary bar ── */}
      <div className="sticky bottom-0 z-10 mt-8 -mx-4 sm:-mx-6 border-t border-border bg-background/95 backdrop-blur-sm px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {name.trim() || <span className="text-muted-foreground">{t('summary.untitled')}</span>}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {selectedPlatforms.length > 0
                ? selectedPlatforms.map((p) => PLATFORM_ABBR[p]).join(' · ')
                : '—'}
              {endDate ? ` · ~${estimated} posts` : ''}
            </p>
          </div>

          <button
            type="submit"
            disabled={!isValid || isPending}
            className="shrink-0 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? '…' : t('cta')}
          </button>
        </div>
      </div>
    </form>
  )
}

// ── Local primitives ──────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{children}</h2>
      <div className="mt-1.5 h-px bg-border" />
    </div>
  )
}

function Field({
  label,
  htmlFor,
  required,
  optional,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  optional?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        {optional && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{optional}</span>
        )}
      </label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function LimitBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/30">
      <p className="text-sm text-amber-800 dark:text-amber-300">{children}</p>
    </div>
  )
}
