/**
 * Route smoke test (ADR 0009 §14, §16) — real-network, env-gated like
 * lib/email/__integration__/round-trip.test.ts so the default suite stays
 * green with no flake. Run with a server up (npm run dev or a prod serve):
 *
 *   ROUTE_SMOKE_TEST_ENABLED=true npx vitest run "app/[locale]/(marketing)/__integration__"
 *
 * SMOKE_BASE_URL overrides the target (default http://localhost:3000).
 * Assertions check load-bearing strings only — no page snapshots (§14).
 */
import { describe, it, expect } from 'vitest'

const ENABLED = process.env.ROUTE_SMOKE_TEST_ENABLED === 'true'
// Scoped name — a bare BASE_URL is already set to '/' in this environment.
const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000'

const d = ENABLED ? describe : describe.skip

d('marketing route smoke (ADR 0009 §14)', () => {
  it('/ returns 200 and contains the locked hero phrase', async () => {
    const res = await fetch(`${BASE_URL}/en`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('makes sure your market does')
  })

  it('/pricing returns 200 and renders both capability-sourced prices', async () => {
    const res = await fetch(`${BASE_URL}/en/pricing`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('€99')
    expect(html).toContain('€199')
  })

  it.each(['terms', 'privacy'])('/%s (footer legal link) returns 200', async (slug) => {
    const res = await fetch(`${BASE_URL}/en/${slug}`)
    expect(res.status).toBe(200)
  })

  it('/og?route=home returns an image/png', async () => {
    const res = await fetch(`${BASE_URL}/en/og?route=home`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
  })
})
