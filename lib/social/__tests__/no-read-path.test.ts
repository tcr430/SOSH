import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Importing linkedin-provider.ts / twitter-provider.ts pulls in
// '@/lib/config' at module load time (its top-level `import { config }`),
// which throws in the test environment without real env vars — the same
// mock provider-contract.test.ts already uses.
vi.mock('@/lib/config', () => ({
  config: {
    server: {
      LINKEDIN_CLIENT_ID: 'no-read-path-test-linkedin-client-id',
      LINKEDIN_CLIENT_SECRET: 'no-read-path-test-linkedin-client-secret',
      X_CLIENT_ID: 'no-read-path-test-x-client-id',
      X_CLIENT_SECRET: 'no-read-path-test-x-client-secret',
    },
    public: { NODE_ENV: 'test' },
  },
}))

import { MockProvider } from '../mock-provider'
import { LinkedInProvider } from '../linkedin-provider'
import { TwitterProvider } from '../twitter-provider'
import * as socialBarrel from '../index'

// SOCIAL-NO-READ-PATH — INVERTED at Session 32 I2.2 (ADR 0002 Amendment B
// §B.4), not deleted, so this file's history stays traceable: it used to
// assert fetchRecentPosts/listRecentPosts did NOT exist anywhere under
// lib/social/ (ADR 0028 build-guide N2.13, §12 — "this session builds OAuth,
// publish, refresh, revoke and metrics, never a content READ path"). Amendment
// B is that read path's own deliverable — the assertion is flipped to prove
// the opposite property that now matters: the read method EXISTS on every
// implementation, AND every consumer still reaches it only through the
// barrel (lib/social/index.ts), never by importing a *-provider module
// directly. The boundary this test protects (no direct provider import
// outside lib/social/) never changed; only what "the read path" means did.
const ROOT = process.cwd()
const SOCIAL_DIR = path.join(ROOT, 'lib', 'social')
const SCAN_ROOTS = [path.join(ROOT, 'lib'), path.join(ROOT, 'app')]
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '__fixtures__', '.next'])
const PROVIDER_IMPORT_PATTERN = /from\s+['"]@\/lib\/social\/(linkedin-provider|twitter-provider|mock-provider)['"]/

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectTsFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('SOCIAL-NO-READ-PATH (ADR 0002 Amendment B §B.4 — inverted, not deleted)', () => {
  // BACKFILL-READ-ON-ABSTRACTION (ADR 0025 §12 constraint 1) — the read
  // contract's runtime-checkable pieces (the constants and the shared bound
  // guard; the three interface TYPES are erased at runtime and are proven
  // instead by tsc + the eight-method assertion below) must be reachable
  // through the barrel, not just defined in their own module.
  it('the read contract is exported via lib/social/index.ts, not just defined in its own module', () => {
    expect(typeof socialBarrel.assertRecentPostsPageSize).toBe('function')
    expect(socialBarrel.RECENT_POSTS_PAGE_SIZE_MIN).toBe(5)
    expect(socialBarrel.RECENT_POSTS_PAGE_SIZE_MAX).toBe(100)
    expect(socialBarrel.RECENT_POST_CONTENT_MAX_CHARS).toBe(3000)
  })

  it('fetchRecentPosts exists on every SocialProvider implementation under lib/social/', () => {
    const implementations: Array<{ name: string; provider: { fetchRecentPosts: unknown } }> = [
      { name: 'MockProvider', provider: new MockProvider() },
      { name: 'LinkedInProvider', provider: new LinkedInProvider() },
      { name: 'TwitterProvider', provider: new TwitterProvider() },
    ]
    for (const { name, provider } of implementations) {
      expect(typeof provider.fetchRecentPosts, `${name}.fetchRecentPosts is not a function`).toBe('function')
    }
  })

  it('no file outside lib/social/ imports a *-provider module directly — every consumer uses the barrel', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectTsFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const files = SCAN_ROOTS.flatMap((root) => collectTsFiles(root)).filter(
      (file) => !file.startsWith(SOCIAL_DIR + path.sep),
    )
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      if (PROVIDER_IMPORT_PATTERN.test(source)) {
        offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })
})
