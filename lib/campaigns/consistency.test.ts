import { describe, it, expect } from 'vitest'
import { checkRoleCoverage, checkLinkPlacement } from './consistency'
import type { CampaignBriefContent } from '@/lib/db/types'
import type { ThreadOutput } from '@/lib/ai/prompts/formats/schemas'

const expectedSequence: CampaignBriefContent['roleSequence'] = [
  { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'a' },
  { order: 1, role: 'customer_proof', platform: 'twitter', angle: 'b' },
  { order: 2, role: 'follow_up', platform: 'linkedin', angle: 'c' },
]

describe('checkRoleCoverage (MODE2-ROLE-COVERAGE, ADR §8 [type-6])', () => {
  it('passes when every roleSequence order is fulfilled', () => {
    const result = checkRoleCoverage([{ order: 0 }, { order: 1 }, { order: 2 }], expectedSequence)
    expect(result.ok).toBe(true)
    expect(result.missingOrders).toEqual([])
  })

  it('REDDENS when an assigned role is unfulfilled (order 1 missing)', () => {
    const result = checkRoleCoverage([{ order: 0 }, { order: 2 }], expectedSequence)
    expect(result.ok).toBe(false)
    expect(result.missingOrders).toEqual([1])
  })

  it('reports ALL missing orders, not just the first', () => {
    const result = checkRoleCoverage([{ order: 0 }], expectedSequence)
    expect(result.missingOrders).toEqual([1, 2])
  })

  it('passes trivially on an empty expected sequence', () => {
    const result = checkRoleCoverage([], [])
    expect(result.ok).toBe(true)
  })
})

function makeThread(firstPostText: string): ThreadOutput {
  return {
    format: 'thread',
    posts: [
      { text: firstPostText, role: 'hook' },
      { text: 'middle', role: 'pull_quote' },
      { text: 'closing', role: 'close' },
    ],
    imageBrief: null,
    scriptBrief: null,
  }
}

describe('checkLinkPlacement (MODE2-LINK-PLACEMENT, ADR §8 item 2)', () => {
  it('passes when tweet 1 has no link', () => {
    const result = checkLinkPlacement([makeThread('Here is a strong hook with no URL')])
    expect(result.ok).toBe(true)
  })

  it('REDDENS when tweet 1 (posts[0]) contains an https:// link', () => {
    const result = checkLinkPlacement([makeThread('Check this out: https://example.com/proof')])
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(1)
  })

  it('REDDENS when tweet 1 contains a bare www. link', () => {
    const result = checkLinkPlacement([makeThread('See www.example.com for proof')])
    expect(result.ok).toBe(false)
  })

  it('does NOT flag a link in the LAST tweet (allowed)', () => {
    const thread: ThreadOutput = {
      format: 'thread',
      posts: [
        { text: 'A hook with no link', role: 'hook' },
        { text: 'Some proof', role: 'pull_quote' },
        { text: 'Read more: https://example.com', role: 'close' },
      ],
      imageBrief: null,
      scriptBrief: null,
    }
    const result = checkLinkPlacement([thread])
    expect(result.ok).toBe(true)
  })

  it('checks every thread in the set independently', () => {
    const good = makeThread('A clean hook')
    const bad = makeThread('Bad hook https://example.com')
    const result = checkLinkPlacement([good, bad])
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(1)
  })

  it('passes trivially on an empty set', () => {
    expect(checkLinkPlacement([]).ok).toBe(true)
  })
})
