import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0028 §2.1 (N2.6) — SOCIAL-NO-SECRET-EGRESS, Tier-3 half. Client secrets
// are read ONLY through lib/config.ts's serverOnly() getter, which throws if
// touched from a client bundle at runtime — this scan is the compile-time
// companion: proves no OTHER file reads LINKEDIN_CLIENT_SECRET or
// X_CLIENT_SECRET at all, today. As of this session both are declared but
// unused (ADR 0028 §2.1) — no provider exists yet to legitimately read them.
// N2.7/N2.8 (LinkedInProvider/TwitterProvider) are the only files expected
// to ever add a match here; when they land, this allowlist gets extended
// deliberately, in that step's own commit — not silently.

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '__fixtures__', '.next'])

function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

const ROOT = process.cwd()
const LIB_DIR = path.join(ROOT, 'lib')
const APP_DIR = path.join(ROOT, 'app')
const COMPONENTS_DIR = path.join(ROOT, 'components')
const CONFIG_FILE = path.join(ROOT, 'lib', 'config.ts')

describe('SOCIAL-NO-SECRET-EGRESS — no client-reachable module imports a client-secret getter (ADR 0028 §2.1)', () => {
  const SCAN_ROOTS = [LIB_DIR, APP_DIR, COMPONENTS_DIR]

  it('LINKEDIN_CLIENT_SECRET and X_CLIENT_SECRET are read nowhere but lib/config.ts today', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectTsFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const files = SCAN_ROOTS.flatMap((root) => collectTsFiles(root)).filter((f) => f !== CONFIG_FILE)
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      if (/LINKEDIN_CLIENT_SECRET|X_CLIENT_SECRET/.test(source)) {
        offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })

  it('the getters themselves still exist in lib/config.ts (guards against the scan silently passing because the surface was removed)', () => {
    const source = fs.readFileSync(CONFIG_FILE, 'utf8')
    expect(source).toContain('LINKEDIN_CLIENT_SECRET')
    expect(source).toContain('X_CLIENT_SECRET')
  })
})
