import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// BACKFILL-VAULT-PATH-REUSED (ADR 0025 §12 constraint 12, I2.3 item 5). I2.0
// recorded the baseline: exactly TWO production get_vault_secret call sites
// (vault.ts's queryVaultSecret wrapper, and TwitterProvider.revokeAccessToken's
// pre-existing direct RPC call — a Session 30.5 property, not something I2.3
// introduced). fetchRecentPosts reuses withFreshToken/vault.ts for every page
// instead of calling the RPC itself, so the count must stay at 2, never grow.
const ROOT = process.cwd()
const SCAN_ROOTS = [path.join(ROOT, 'lib'), path.join(ROOT, 'app')]
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '__fixtures__', '.next'])
const GET_VAULT_SECRET_CALL_PATTERN = /\.rpc\(\s*['"]get_vault_secret['"]/
const I2_0_BASELINE_CALL_SITE_COUNT = 2

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

describe('BACKFILL-VAULT-PATH-REUSED — get_vault_secret call-site count', () => {
  it('production call-site count equals the I2.0 baseline (2)', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectTsFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const files = SCAN_ROOTS.flatMap((root) => collectTsFiles(root))
    expect(files.length).toBeGreaterThan(0)

    const callSites: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      if (GET_VAULT_SECRET_CALL_PATTERN.test(source)) {
        callSites.push(path.relative(ROOT, file).replace(/\\/g, '/'))
      }
    }
    expect(callSites.sort()).toEqual(['lib/social/twitter-provider.ts', 'lib/social/vault.ts'])
    expect(callSites).toHaveLength(I2_0_BASELINE_CALL_SITE_COUNT)
  })
})
