import { describe, it, expect, vi, beforeEach } from 'vitest'

// MINOR-5 (Session 33-D D5) — loadCampaignLearningView's `unavailablePlatforms` is wired to /lib/social/'s declared
// capability, not to a platform name and not to whether the campaign has measured anything. The readers are stubbed;
// the capability is a mutable map the tests FLIP.

const state = vi.hoisted(() => ({
  capability: { linkedin: false, twitter: true } as Record<string, boolean>,
  sources: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/social', () => ({ metricsReadAvailableFor: (p: string) => state.capability[p] ?? false }))
vi.mock('@/lib/db/campaign-retrospectives', () => ({
  getCampaignRetrospective: async () => null,
  listCampaignPostStates: async () => [],
  getFrozenBriefContent: async () => null,
  listCampaignOutcomeCellSources: async () => state.sources,
}))
vi.mock('@/lib/db/memory-performance', () => ({ listOutcomePatterns: async () => [] }))

import { loadCampaignLearningView } from '../campaign-view'

const client = {} as never
const measuredLinkedIn = [{ platform: 'linkedin', length_band: 'short', cta_present: false, role: null, format: null, origin_mode: null }]

beforeEach(() => {
  state.capability = { linkedin: false, twitter: true }
  state.sources = []
})

describe('loadCampaignLearningView — unavailablePlatforms comes from the platform capability', () => {
  it('capability false: reported whether or not the campaign has measured rows (a NEW campaign is not the trigger)', async () => {
    state.sources = []
    expect((await loadCampaignLearningView(client, 'b', 'c', ['linkedin'])).unavailablePlatforms).toEqual(['linkedin'])
    state.sources = measuredLinkedIn
    expect((await loadCampaignLearningView(client, 'b', 'c', ['linkedin'])).unavailablePlatforms).toEqual(['linkedin'])
  })

  it('FLIP the capability to true and the disclosure disappears, in both states', async () => {
    state.capability.linkedin = true
    state.sources = []
    expect((await loadCampaignLearningView(client, 'b', 'c', ['linkedin'])).unavailablePlatforms).toEqual([])
    state.sources = measuredLinkedIn
    expect((await loadCampaignLearningView(client, 'b', 'c', ['linkedin'])).unavailablePlatforms).toEqual([])
  })

  it('a twitter-only campaign reports nothing unavailable, measured or not', async () => {
    state.sources = []
    expect((await loadCampaignLearningView(client, 'b', 'c', ['twitter'])).unavailablePlatforms).toEqual([])
    state.sources = [{ ...measuredLinkedIn[0], platform: 'twitter' }]
    expect((await loadCampaignLearningView(client, 'b', 'c', ['twitter'])).unavailablePlatforms).toEqual([])
  })
})
