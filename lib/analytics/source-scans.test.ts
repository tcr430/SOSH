import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { MEMORY_WRITERS } from '@/lib/memory/writers'

// ADR 0031 §12.3 / build-guide O2.1 — the "properties of absence" for Session 37 (analytics and the monthly
// report), written BEFORE any code they fence (the ADR 0023 G1b.2 and ADR 0026 J2.2 precedent), so a violation
// introduced in O2.3-O2.9 fails CI the moment it lands. Each scan has TWO halves, because a scan that has never
// failed proves nothing:
//   1. a pure DETECTOR, unit-tested against a PLANTED POSITIVE and a PLANTED NEGATIVE written in the detector's
//      own vocabulary (cerebrum 2026-09-24). This half runs in CI forever, so the scan cannot rot into a
//      vacuous pass; and
//   2. the detector run over the REAL tree.
//
// Tier note (ADR 0031 §12.3): ADR 0015 defines Tier 3 as "diff-verified, no runtime test". Every scan here is a
// vitest source scan executed by app-tests.yml, so by ADR 0015's wording each is Tier 2 ("2 (scan)" in §13).
//
//   CLOSED HERE         #1 ANALYTICS-READ-ONLY (two arms)         #19 ANALYTICS-NORTHSTAR-FENCED (whole repo)
//                       #32 ANALYTICS-NO-NEW-DEPENDENCY           #38 ANALYTICS-NO-MEMORY-WRITER
//                       #39 REPORT-NO-MODEL
//   SCAN HALF AUTHORED  #13 ANALYTICS-NO-LOG-LIFT (closes O2.3)   #16 ANALYTICS-AUTHENTICATED-READS (closes O2.4)
//                       #20 ANALYTICS-CAMPAIGN-VIEW-SINGLE-SOURCE (closes O2.5)
//                       #23 REPORT-MEMBERS-ONLY (closes O2.8)
//
// Tests are excluded from the real-tree scans (they legitimately contain planted strings). __fixtures__ is
// excluded from the analytics-roots walks only; the whole-repo northstar scan walks it.

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.wolf', '.claude', '.playwright-mcp'])
const FIXTURE_DIR = '__fixtures__'

function toRel(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

function collect(dir: string, skip: ReadonlySet<string>, keep: (name: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, skip, keep, out)
    else if (keep(entry.name)) out.push(full)
  }
  return out
}

const isProdTs = (name: string) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)

function stripTsComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

interface ImportRef {
  specifier: string
  /** The named bindings (`{ a, b as c, type d }` -> a, b, d). Empty for a default, namespace or side-effect form. */
  names: string[]
  /** True when anything other than a plain `{ ... }` list is imported (default, `* as x`, side effect, dynamic). */
  whole: boolean
}

function parseImports(source: string): ImportRef[] {
  const code = stripTsComments(source)
  const refs: ImportRef[] = []
  for (const m of code.matchAll(/\b(?:import|export)\s+(?:type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const clause = m[1].trim()
    const braces = clause.match(/\{([^}]*)\}/)
    const names = braces
      ? braces[1]
          .split(',')
          .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
          .filter(Boolean)
      : []
    const outside = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim()
    refs.push({ specifier: m[2], names, whole: outside.length > 0 })
  }
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) refs.push({ specifier: m[1], names: [], whole: true })
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    refs.push({ specifier: m[1], names: [], whole: true })
  }
  return refs
}

// ─── The roots (ADR 0031 §12.3) ───────────────────────────────────────────────────────────────────────────────
// A root that does not exist yet is PENDING. EXPECTED_PENDING is a tripwire, not a manifest of exemptions: the
// step that creates a root MUST remove it from the list in the same commit, which is what makes every scan below
// start covering it. O2.12 closes the session by emptying the list: every root non-empty (build-guide O2.1).
const ROOT_DIRS = [
  'lib/analytics',
  'lib/reports',
  'app/[locale]/(dashboard)/analytics',
  'components/analytics',
  'app/api/analytics',
  'app/api/cron/generate-reports',
] as const
const ROOT_FILES = ['lib/email/templates/monthly-report.tsx'] as const
const ALL_ROOTS: readonly string[] = [...ROOT_DIRS, ...ROOT_FILES]

function rootProdFiles(root: string): string[] {
  const abs = path.join(ROOT, root)
  if (!fs.existsSync(abs)) return []
  return fs.statSync(abs).isDirectory()
    ? collect(abs, new Set([...SKIP_DIRS, FIXTURE_DIR]), isProdTs)
    : [abs]
}

function filesOf(roots: readonly string[]): string[] {
  return roots.flatMap(rootProdFiles)
}

function scan(roots: readonly string[], detector: (rel: string, source: string) => string[]): string[] {
  return filesOf(roots).flatMap((file) => detector(toRel(file), fs.readFileSync(file, 'utf8')))
}

// lib/analytics gained its first production file in O2.3 (the pure aggregation); the analytics page root and
// components/analytics in O2.6 (the live surfaces), lib/reports in O2.7 (the assembler and generator), so each left the
// list in that commit. The cron route and the monthly-report template left it in O2.8; only app/api/analytics (the PDF
// route, O2.9) is still pending.
const POPULATED_ROOTS: readonly string[] = [
  'lib/analytics',
  'app/[locale]/(dashboard)/analytics',
  'components/analytics',
  'lib/reports',
  'app/api/cron/generate-reports',
  'lib/email/templates/monthly-report.tsx',
]
const EXPECTED_PENDING: readonly string[] = ALL_ROOTS.filter((root) => !POPULATED_ROOTS.includes(root))

describe('the scan roots (build-guide O2.1)', () => {
  it('a root with production files is no longer pending: the tripwire list must say exactly which roots are still empty', () => {
    const pendingNow = ALL_ROOTS.filter((root) => rootProdFiles(root).length === 0)
    expect(
      pendingNow,
      'A root gained (or lost) production files. Update EXPECTED_PENDING in lib/analytics/source-scans.test.ts in the same commit.',
    ).toEqual([...EXPECTED_PENDING])
  })

  it('every root path is spelled as the ADR names it (a typo would make a scan walk nothing, forever)', () => {
    expect(ALL_ROOTS).toHaveLength(7)
    expect(ROOT_DIRS.every((r) => !r.startsWith('/') && !r.includes('\\'))).toBe(true)
    expect(ROOT_FILES).toEqual(['lib/email/templates/monthly-report.tsx'])
    // The monthly-report template lives beside the registered team-invite template (ADR 0031 §5.4).
    expect(fs.existsSync(path.join(ROOT, 'lib/email/templates/team-invite.tsx'))).toBe(true)
  })

  it.todo('O2.12: EXPECTED_PENDING is empty (every root has production files)')
})

// ═══ the import detector, shared by several scans ════════════════════════════════════════════════════════════
describe('parseImports (the detector the import scans share)', () => {
  it('reads named, default, namespace, type, re-export, side-effect, dynamic and require forms', () => {
    const refs = parseImports(
      [
        "import { a, b as c, type D } from '@/x/one'",
        "import def from '@/x/two'",
        "import * as ns from '@/x/three'",
        "import type { T } from '@/x/four'",
        "export { e } from '@/x/five'",
        "import '@/x/six'",
        "const m = await import('@/x/seven')",
        "const r = require('@/x/eight')",
        "// import { hidden } from '@/x/commented'",
      ].join('\n'),
    )
    const bySpec = Object.fromEntries(refs.map((r) => [r.specifier, r]))
    expect(bySpec['@/x/one']).toMatchObject({ names: ['a', 'b', 'D'], whole: false })
    expect(bySpec['@/x/two']).toMatchObject({ names: [], whole: true })
    expect(bySpec['@/x/three']).toMatchObject({ whole: true })
    expect(bySpec['@/x/four']).toMatchObject({ names: ['T'], whole: false })
    expect(bySpec['@/x/five']).toMatchObject({ names: ['e'] })
    expect(bySpec['@/x/six']).toMatchObject({ whole: true })
    expect(bySpec['@/x/seven']).toMatchObject({ whole: true })
    expect(bySpec['@/x/eight']).toMatchObject({ whole: true })
    expect(bySpec['@/x/commented']).toBeUndefined()
  })

  it('reads a multi-line named import', () => {
    const refs = parseImports("import {\n  alpha,\n  beta,\n} from '@/x/multi'\n")
    expect(refs).toEqual([{ specifier: '@/x/multi', names: ['alpha', 'beta'], whole: false }])
  })
})

// ═══ #1 ANALYTICS-READ-ONLY (arm a): no platform API call — nothing from lib/social but metricsReadAvailableFor ═══
// ADR 0031 §12.3 #1. ONLY the capability read may cross into lib/social, and only through the barrel.

function socialImportViolations(rel: string, source: string): string[] {
  const offences: string[] = []
  for (const ref of parseImports(source)) {
    const isSocial = /^@\/lib\/social(\/|$)/.test(ref.specifier) || /(^|\/)lib\/social(\/|$)/.test(ref.specifier)
    if (!isSocial) continue
    const barrel = ref.specifier.replace(/\/index$/, '')
    const onlyCapability = ref.names.length > 0 && ref.names.every((n) => n === 'metricsReadAvailableFor')
    if (barrel !== '@/lib/social' || ref.whole || !onlyCapability) {
      offences.push(`${rel}: imports ${ref.specifier} (${ref.whole ? 'whole module' : ref.names.join(', ')})`)
    }
  }
  return offences
}

describe('ANALYTICS-READ-ONLY, arm (a): no platform API call (scan #1a)', () => {
  it('PLANTED POSITIVE: a deep provider import, a second named import, a namespace import and a dynamic import all fail', () => {
    expect(socialImportViolations('p.ts', "import { getRegistry } from '@/lib/social'")).toHaveLength(1)
    expect(socialImportViolations('p.ts', "import { metricsReadAvailableFor, getRegistry } from '@/lib/social'")).toHaveLength(1)
    expect(socialImportViolations('p.ts', "import { metricsReadAvailableFor } from '@/lib/social/platforms/config'")).toHaveLength(1)
    expect(socialImportViolations('p.ts', "import * as social from '@/lib/social'")).toHaveLength(1)
    expect(socialImportViolations('p.ts', "const s = await import('@/lib/social/registry')")).toHaveLength(1)
    expect(socialImportViolations('p.ts', "import { PLATFORM_CONFIGS } from '../../lib/social/platforms/config'")).toHaveLength(1)
  })

  it('PLANTED NEGATIVE: the capability read through the barrel, and an unrelated import, pass', () => {
    expect(socialImportViolations('n.ts', "import { metricsReadAvailableFor } from '@/lib/social'")).toEqual([])
    expect(socialImportViolations('n.ts', "import { metricsReadAvailableFor } from '@/lib/social/index'")).toEqual([])
    expect(socialImportViolations('n.ts', "import type { Platform } from '@/lib/db/types'")).toEqual([])
    expect(socialImportViolations('n.ts', "// import { getRegistry } from '@/lib/social'")).toEqual([])
  })

  it('REAL TREE: no analytics or report path imports anything from lib/social but metricsReadAvailableFor', () => {
    expect(scan(ALL_ROOTS, socialImportViolations)).toEqual([])
  })
})

// ═══ #1 ANALYTICS-READ-ONLY (arm b): no write to a measurement table ═════════════════════════════════════════
// ADR 0031 §12.3 #2/#1. A write-verb regex alone cannot see a write delegated to a lib/db helper (cerebrum
// 2026-09-23), so the scan names the table literals, the writer RPC AND the writer functions, and a completeness
// test fails if a lib/db file gains a writer this list does not name.

const MEASUREMENT_TABLES = ['post_metrics', 'post_outcomes', 'post_dimensions', 'campaign_retrospectives'] as const
const MEASUREMENT_WRITE_RPCS = ['acknowledge_campaign_retrospective'] as const
// lib/db function -> file. Every exported function in these files that inserts, updates, upserts, deletes or calls a
// write RPC must be listed (the completeness test below), and every listed name must still exist (staleness).
const MEASUREMENT_WRITER_FUNCTIONS: Readonly<Record<string, string>> = {
  insertPostOutcome: 'lib/db/post-outcomes.ts',
  upsertPostMetrics: 'lib/db/post-metrics.ts',
  insertCampaignRetrospective: 'lib/db/campaign-retrospectives.ts',
  acknowledgeRetrospective: 'lib/db/campaign-retrospectives.ts',
}

function measurementWriteViolations(rel: string, source: string): string[] {
  const code = stripTsComments(source)
  const offences: string[] = []
  const tableWrite = new RegExp(
    `\\.from\\(\\s*['"](${MEASUREMENT_TABLES.join('|')})['"]\\s*\\)(?:(?!\\.from\\()[\\s\\S]){0,600}?\\.(insert|update|upsert|delete)\\s*\\(`,
    'g',
  )
  for (const m of code.matchAll(tableWrite)) offences.push(`${rel}: .${m[2]}() against ${m[1]}`)
  const rpcWrite = new RegExp(`\\.rpc\\(\\s*['"](${MEASUREMENT_WRITE_RPCS.join('|')})['"]`, 'g')
  for (const m of code.matchAll(rpcWrite)) offences.push(`${rel}: .rpc('${m[1]}')`)
  const fnWrite = new RegExp(`\\b(${Object.keys(MEASUREMENT_WRITER_FUNCTIONS).join('|')})\\b`, 'g')
  for (const m of code.matchAll(fnWrite)) offences.push(`${rel}: uses the measurement writer ${m[1]}`)
  return offences
}

describe('ANALYTICS-READ-ONLY, arm (b): no write to a measurement table (scan #1b)', () => {
  it('PLANTED POSITIVE: each write verb against each table, the write RPC and each delegated writer all fail', () => {
    for (const table of MEASUREMENT_TABLES) {
      for (const verb of ['insert', 'update', 'upsert', 'delete']) {
        const src = `await client\n  .from('${table}')\n  .${verb}({ business_id: id })\n  .eq('business_id', id)`
        expect(measurementWriteViolations('p.ts', src), `${verb} ${table}`).toHaveLength(1)
      }
    }
    expect(measurementWriteViolations('p.ts', "await client.rpc('acknowledge_campaign_retrospective', args)")).toHaveLength(1)
    for (const fn of Object.keys(MEASUREMENT_WRITER_FUNCTIONS)) {
      expect(measurementWriteViolations('p.ts', `import { ${fn} } from '@/lib/db/x'\nawait ${fn}(row)`).length, fn).toBeGreaterThan(0)
    }
  })

  it('PLANTED NEGATIVE: a read of each table, and a write to an unrelated table in the same file, pass', () => {
    for (const table of MEASUREMENT_TABLES) {
      expect(measurementWriteViolations('n.ts', `await client.from('${table}').select('*').eq('business_id', id).order('id').limit(5)`)).toEqual([])
    }
    // The write verb belongs to a LATER .from(): the tempered window must stop at the next table.
    const src = "await client.from('post_outcomes').select('*').limit(1)\nawait client.from('email_outbox').insert(row)"
    expect(measurementWriteViolations('n.ts', src)).toEqual([])
    expect(measurementWriteViolations('n.ts', "// await insertPostOutcome(row)")).toEqual([])
  })

  it('COMPLETENESS: every writer in the lib/db measurement files is named above, and every name still exists', () => {
    const found: Record<string, string> = {}
    for (const rel of ['lib/db/post-outcomes.ts', 'lib/db/post-metrics.ts', 'lib/db/campaign-retrospectives.ts']) {
      const source = stripTsComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
      for (const chunk of source.split(/\nexport /).slice(1)) {
        const name = chunk.match(/^(?:async\s+)?function\s+(\w+)/)?.[1]
        if (!name) continue
        const writes =
          /\.(insert|update|upsert|delete)\s*\(/.test(chunk) || /\.rpc\(\s*['"]acknowledge_campaign_retrospective['"]/.test(chunk)
        if (writes) found[name] = rel
      }
    }
    expect(found).toEqual({ ...MEASUREMENT_WRITER_FUNCTIONS })
  })

  it('REAL TREE: no analytics or report path writes to post_metrics, post_outcomes, post_dimensions or campaign_retrospectives', () => {
    expect(scan(ALL_ROOTS, measurementWriteViolations)).toEqual([])
  })
})

// ═══ #19 ANALYTICS-NORTHSTAR-FENCED: whole repository ════════════════════════════════════════════════════════
// ADR 0031 §9.6. The cross-brand northstar is an operator metric. It is spelled below from fragments so this test
// file does not trip its own scan (it is NOT on the allowlist, which stays exactly the ADR's).

const NORTHSTAR_FN = ['getLearning', 'CyclesNorthstar'].join('')
const NORTHSTAR_RPC = ['get_learning', '_cycles_northstar'].join('')
const NORTHSTAR_ALLOWLIST_EXACT: readonly string[] = [
  'lib/db/campaign-retrospectives.ts',
  'scripts/northstar-report.ts',
  // Their tests: every file in the repo that names the symbol today, pinned exactly (a directory prefix would hide a second reader).
  'lib/outcomes/__tests__/no-cross-business.test.ts',
  'supabase/__tests__/outcome-northstar.test.ts',
  'supabase/__tests__/outcome-wrappers.test.ts',
  'supabase/__tests__/wilson-bounds.test.ts',
]
const northstarAllowed = (rel: string): boolean => NORTHSTAR_ALLOWLIST_EXACT.includes(rel) || rel.startsWith('supabase/migrations/')

function northstarViolations(rel: string, source: string): string[] {
  if (northstarAllowed(rel)) return []
  const code = stripTsComments(source)
  const re = new RegExp(`${NORTHSTAR_FN}|${NORTHSTAR_RPC}`, 'g')
  const hits = [...code.matchAll(re)].map((m) => m[0])
  return hits.length === 0 ? [] : [`${rel}: names ${[...new Set(hits)].join(', ')}`]
}

function repoSourceFiles(): string[] {
  return collect(ROOT, SKIP_DIRS, (n) => /\.(ts|tsx|mjs)$/.test(n))
}

describe('ANALYTICS-NORTHSTAR-FENCED (scan #19, whole repository)', () => {
  it('PLANTED POSITIVE: an import under app/ and one under lib/email/ both fail; so does the bare RPC literal', () => {
    const imp = `import { ${NORTHSTAR_FN} } from '@/lib/db/campaign-retrospectives'\nawait ${NORTHSTAR_FN}(since)`
    expect(northstarViolations('app/[locale]/(dashboard)/analytics/page.tsx', imp)).toHaveLength(1)
    expect(northstarViolations('lib/email/templates/monthly-report.tsx', imp)).toHaveLength(1)
    const rpc = `await client.rpc('${NORTHSTAR_RPC}', { since })`
    expect(northstarViolations('lib/reports/assemble.ts', rpc)).toHaveLength(1)
    expect(northstarViolations('scripts/other.mjs', rpc)).toHaveLength(1)
    expect(northstarViolations('lib/analytics/__fixtures__/x.ts', imp)).toHaveLength(1)
  })

  it('PLANTED NEGATIVE: the allowlisted definition, script, tests and migrations pass; a comment mention passes', () => {
    const imp = `await ${NORTHSTAR_FN}(since)`
    for (const rel of NORTHSTAR_ALLOWLIST_EXACT) expect(northstarViolations(rel, imp), rel).toEqual([])
    expect(northstarViolations('supabase/migrations/20990101000000_x.ts', imp)).toEqual([])
    expect(northstarViolations('lib/reports/a.ts', `// the operator metric is ${NORTHSTAR_FN}, not used here`)).toEqual([])
    expect(northstarViolations('lib/reports/a.ts', 'const label = "northstar"')).toEqual([])
  })

  it('STALENESS: every allowlisted file still exists and still names the symbol', () => {
    for (const rel of NORTHSTAR_ALLOWLIST_EXACT) {
      const abs = path.join(ROOT, rel)
      expect(fs.existsSync(abs), `${rel} no longer exists: shrink the allowlist`).toBe(true)
      expect(new RegExp(`${NORTHSTAR_FN}|${NORTHSTAR_RPC}`).test(stripTsComments(fs.readFileSync(abs, 'utf8'))), `${rel} no longer names the symbol: shrink the allowlist`).toBe(true)
    }
  })

  it('REAL TREE: no file in the repository (*.ts, *.tsx, *.mjs) outside the allowlist names the northstar', () => {
    const files = repoSourceFiles()
    expect(files.length, 'the repo walk found nothing: the scan is vacuous').toBeGreaterThan(500)
    const offenders = files.flatMap((f) => northstarViolations(toRel(f), fs.readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

// ═══ #32 ANALYTICS-NO-NEW-DEPENDENCY: package.json ═══════════════════════════════════════════════════════════
// BASE = 0da603b4a (the master merge session-37-adr-0031 was cut from). The baseline is a literal list, and the only
// additions allowed are the A-3 packages as RULED in session-37.md §0.2 and amended by the O2.0 spike (V.3): the
// charting set WITHOUT @visx/axis (it calls a hook through @visx/text and cannot render in the PDF's static render).

const BASELINE_DEPENDENCIES: readonly string[] = [
  '@anthropic-ai/sdk', '@base-ui/react', '@dnd-kit/core', '@dnd-kit/utilities', '@hookform/resolvers', '@mdx-js/loader',
  '@mdx-js/react', '@next/mdx', '@octokit/auth-app', '@octokit/request', '@radix-ui/react-label', '@radix-ui/react-slot',
  '@react-email/components', '@react-email/render', '@sentry/nextjs', '@supabase/ssr', '@supabase/supabase-js',
  '@tailwindcss/typography', '@upstash/qstash', '@vercel/analytics', '@vercel/speed-insights', 'class-variance-authority',
  'clsx', 'date-fns', 'date-fns-tz', 'diff', 'jose', 'lucide-react', 'next', 'next-intl', 'react', 'react-dom',
  'react-hook-form', 'remark-frontmatter', 'remark-mdx-frontmatter', 'resend', 'sax', 'shadcn', 'stripe', 'svix',
  'tailwind-merge', 'tw-animate-css', 'undici', 'xml2js', 'zod',
]
const BASELINE_DEV_DEPENDENCIES: readonly string[] = [
  '@tailwindcss/postcss', '@types/node', '@types/pg', '@types/react', '@types/react-dom', '@types/sax', '@types/xml2js',
  'eslint', 'eslint-config-next', 'happy-dom', 'pg', 'supabase', 'tailwindcss', 'tsx', 'typescript', 'vitest',
]
const A3_ALLOWED_DEPENDENCIES: readonly string[] = [
  '@visx/scale',
  '@visx/shape',
  '@visx/group',
  'puppeteer-core',
  '@sparticuz/chromium',
]

interface PackageJsonShape {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function unexpectedDependencies(
  pkg: PackageJsonShape,
  baseline: { dependencies: readonly string[]; devDependencies: readonly string[] },
  allowedRuntime: readonly string[],
): string[] {
  const offences: string[] = []
  const check = (section: keyof PackageJsonShape, allowed: readonly string[]) => {
    for (const name of Object.keys(pkg[section] ?? {})) if (!allowed.includes(name)) offences.push(`${section}: ${name}`)
  }
  // The A-3 packages are RUNTIME dependencies only: a devDependency of the same name is a different (unruled) addition.
  check('dependencies', [...baseline.dependencies, ...allowedRuntime])
  check('devDependencies', baseline.devDependencies)
  check('optionalDependencies', [])
  check('peerDependencies', [])
  return offences
}

describe('ANALYTICS-NO-NEW-DEPENDENCY (scan #32)', () => {
  const baseline = { dependencies: BASELINE_DEPENDENCIES, devDependencies: BASELINE_DEV_DEPENDENCIES }
  const baseDeps = Object.fromEntries(BASELINE_DEPENDENCIES.map((n) => [n, '1.0.0']))
  const baseDev = Object.fromEntries(BASELINE_DEV_DEPENDENCIES.map((n) => [n, '1.0.0']))

  it('PLANTED POSITIVE: an unruled package, the DROPPED @visx/axis, an A-3 name in the wrong section, and an optional/peer addition all fail', () => {
    expect(unexpectedDependencies({ dependencies: { ...baseDeps, 'left-pad': '1.0.0' }, devDependencies: baseDev }, baseline, A3_ALLOWED_DEPENDENCIES)).toEqual(['dependencies: left-pad'])
    expect(unexpectedDependencies({ dependencies: { ...baseDeps, '@visx/axis': '4.0.0' }, devDependencies: baseDev }, baseline, A3_ALLOWED_DEPENDENCIES)).toEqual(['dependencies: @visx/axis'])
    expect(unexpectedDependencies({ dependencies: baseDeps, devDependencies: { ...baseDev, '@visx/scale': '4.0.0' } }, baseline, A3_ALLOWED_DEPENDENCIES)).toEqual(['devDependencies: @visx/scale'])
    expect(unexpectedDependencies({ dependencies: baseDeps, devDependencies: baseDev, optionalDependencies: { x: '1' } }, baseline, A3_ALLOWED_DEPENDENCIES)).toEqual(['optionalDependencies: x'])
    expect(unexpectedDependencies({ dependencies: baseDeps, devDependencies: baseDev, peerDependencies: { y: '1' } }, baseline, A3_ALLOWED_DEPENDENCIES)).toEqual(['peerDependencies: y'])
  })

  it('PLANTED NEGATIVE: the baseline, and the baseline plus exactly the five A-3 runtime packages, pass', () => {
    expect(unexpectedDependencies({ dependencies: baseDeps, devDependencies: baseDev }, baseline, A3_ALLOWED_DEPENDENCIES)).toEqual([])
    const withA3 = { ...baseDeps, ...Object.fromEntries(A3_ALLOWED_DEPENDENCIES.map((n) => [n, '1.0.0'])) }
    expect(unexpectedDependencies({ dependencies: withA3, devDependencies: baseDev }, baseline, A3_ALLOWED_DEPENDENCIES)).toEqual([])
  })

  it('the A-3 list is exactly the ruled set: @visx/axis was dropped by the O2.0 spike, nothing else was added', () => {
    expect([...A3_ALLOWED_DEPENDENCIES].sort()).toEqual(['@sparticuz/chromium', '@visx/group', '@visx/scale', '@visx/shape', 'puppeteer-core'])
    expect(A3_ALLOWED_DEPENDENCIES).not.toContain('@visx/axis')
  })

  it('REAL TREE: package.json carries nothing beyond the baseline and the A-3 packages', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageJsonShape
    expect(Object.keys(pkg.dependencies ?? {}).length, 'package.json has no dependencies: the scan is vacuous').toBeGreaterThan(30)
    expect(unexpectedDependencies(pkg, baseline, A3_ALLOWED_DEPENDENCIES)).toEqual([])
  })
})

// ═══ #38 ANALYTICS-NO-MEMORY-WRITER ══════════════════════════════════════════════════════════════════════════
// ADR 0031 §7: analytics READS memory (through lib/memory) and writes none. The forbidden names come from the writer
// REGISTRY (lib/memory/writers.ts), not from memory: every wrapper it lists, every RPC, and the write entry points
// exported by the registry's sole-caller modules under lib/memory/ (record*, ratify*, recompute*, write*, import*,
// upsert*, promote*, demote*, acknowledge*).

const REGISTRY = Object.values(MEMORY_WRITERS)
const SOLE_CALLER_FILES = REGISTRY.map((w) => w.soleCallerModule).filter(
  (m): m is NonNullable<typeof m> => m !== null && m.startsWith('lib/memory/') && m.endsWith('.ts'),
)
const WRITE_VERB = /^(record|ratify|recompute|write|import|upsert|promote|demote|acknowledge)/

function exportedFunctionNames(rel: string): string[] {
  const source = stripTsComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  return [...source.matchAll(/\bexport\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1])
}

const MEMORY_WRITE_NAMES: readonly string[] = [
  ...new Set([
    ...REGISTRY.flatMap((w) => [...w.wrappers]),
    ...SOLE_CALLER_FILES.flatMap((f) => exportedFunctionNames(f).filter((n) => WRITE_VERB.test(n))),
  ]),
]
const MEMORY_WRITE_RPCS: readonly string[] = [...new Set(REGISTRY.flatMap((w) => [...w.rpcNames]))]
const MEMORY_WRITER_MODULES: readonly string[] = SOLE_CALLER_FILES.map((f) => path.basename(f, '.ts'))

function memoryWriterViolations(rel: string, source: string): string[] {
  const code = stripTsComments(source)
  const offences: string[] = []
  for (const m of code.matchAll(new RegExp(`\\b(${MEMORY_WRITE_NAMES.join('|')})\\b`, 'g'))) offences.push(`${rel}: uses the memory writer ${m[1]}`)
  for (const m of code.matchAll(new RegExp(`['"](${MEMORY_WRITE_RPCS.join('|')})['"]`, 'g'))) offences.push(`${rel}: names the memory write RPC ${m[1]}`)
  for (const ref of parseImports(source)) {
    if (new RegExp(`(^|/)lib/memory/(${MEMORY_WRITER_MODULES.join('|')})$`).test(ref.specifier.replace(/^@\//, ''))) {
      offences.push(`${rel}: imports the writer module ${ref.specifier}`)
    }
  }
  return offences
}

describe('ANALYTICS-NO-MEMORY-WRITER (scan #38)', () => {
  it('the forbidden vocabulary is taken from the registry (non-vacuous, and spans every writer family)', () => {
    expect(MEMORY_WRITE_NAMES.length).toBeGreaterThan(10)
    for (const known of ['importEvidenceMemory', 'upsertOutcomePattern', 'recordInterviewCandidates', 'ratifyInterviewCandidates', 'recomputeDismissalSignal', 'importEvidenceItem']) {
      expect(MEMORY_WRITE_NAMES, known).toContain(known)
    }
    expect(MEMORY_WRITE_RPCS).toContain('recompute_dismissal_audience_signal')
    // Readers are NOT writers: analytics reads patterns through the barrel.
    expect(MEMORY_WRITE_NAMES).not.toContain('retrieveOutcomePatterns')
    expect(MEMORY_WRITE_NAMES).not.toContain('listInterviewCandidatesForRound')
  })

  it('PLANTED POSITIVE: a registry wrapper, a lib/memory entry point, a write RPC literal and a writer-module import all fail', () => {
    const wrapper = MEMORY_WRITERS.import.wrappers[0]
    expect(memoryWriterViolations('p.ts', `await ${wrapper}(input)`)).toHaveLength(1)
    expect(memoryWriterViolations('p.ts', "import { recordInterviewCandidates } from '@/lib/memory'")).toHaveLength(1)
    expect(memoryWriterViolations('p.ts', `await client.rpc('${MEMORY_WRITERS.dismissal.rpcNames[0]}', args)`)).toHaveLength(1)
    expect(memoryWriterViolations('p.ts', "import { x } from '@/lib/memory/dismissal'").length).toBeGreaterThan(0)
  })

  it('PLANTED NEGATIVE: reading memory through the barrel, and a comment naming a writer, pass', () => {
    expect(memoryWriterViolations('n.ts', "import { retrieveOutcomePatterns, retrieveMemoryBundle } from '@/lib/memory'")).toEqual([])
    expect(memoryWriterViolations('n.ts', `// never call ${MEMORY_WRITERS.import.wrappers[0]} from here`)).toEqual([])
  })

  it('REAL TREE: no analytics or report path imports or names a memory write function', () => {
    expect(scan(ALL_ROOTS, memoryWriterViolations)).toEqual([])
  })
})

// ═══ #39 REPORT-NO-MODEL ═════════════════════════════════════════════════════════════════════════════════════
// ADR 0031 §6: the narrative is closed templated sentences. No lib/ai, no Anthropic SDK, and no raw-HTML sink
// (the output-encoding constraint's absence half).

function noModelViolations(rel: string, source: string): string[] {
  const offences: string[] = []
  for (const ref of parseImports(source)) {
    if (/^@anthropic-ai\//.test(ref.specifier) || /^@\/lib\/ai(\/|$)/.test(ref.specifier) || /(^|\/)lib\/ai(\/|$)/.test(ref.specifier)) {
      offences.push(`${rel}: imports ${ref.specifier}`)
    }
  }
  if (/dangerouslySetInnerHTML/.test(stripTsComments(source))) offences.push(`${rel}: dangerouslySetInnerHTML`)
  return offences
}

describe('REPORT-NO-MODEL (scan #39)', () => {
  it('PLANTED POSITIVE: lib/ai, the Anthropic SDK (static and dynamic) and dangerouslySetInnerHTML all fail', () => {
    expect(noModelViolations('p.ts', "import { runPrompt } from '@/lib/ai/runner'")).toHaveLength(1)
    expect(noModelViolations('p.ts', "import { x } from '@/lib/ai'")).toHaveLength(1)
    expect(noModelViolations('p.ts', "import Anthropic from '@anthropic-ai/sdk'")).toHaveLength(1)
    expect(noModelViolations('p.ts', "const a = await import('@anthropic-ai/sdk')")).toHaveLength(1)
    expect(noModelViolations('p.tsx', 'return <div dangerouslySetInnerHTML={{ __html: html }} />')).toHaveLength(1)
  })

  it('PLANTED NEGATIVE: a path that merely CONTAINS "ai", and a comment, pass', () => {
    expect(noModelViolations('n.ts', "import { x } from '@/lib/aim/thing'")).toEqual([])
    expect(noModelViolations('n.ts', "import { x } from '@/lib/email/templates'")).toEqual([])
    expect(noModelViolations('n.tsx', '// never use dangerouslySetInnerHTML here')).toEqual([])
  })

  it('REAL TREE: no analytics or report path touches a model or a raw-HTML sink', () => {
    expect(scan(ALL_ROOTS, noModelViolations)).toEqual([])
  })
})

// ═══ #13 ANALYTICS-NO-LOG-LIFT (scan half; the constraint closes in O2.3) ════════════════════════════════════
// ADR 0031 §2.4: log_lift is descriptive only and is rendered NOWHERE (ADR 0026 §10.3 forbids a multiplier). No
// identifier or select string may carry it in the roots.

const LOG_LIFT = /\blog_lift\b|\blogLift\b/

function logLiftViolations(rel: string, source: string): string[] {
  return LOG_LIFT.test(stripTsComments(source)) ? [`${rel}: names log_lift`] : []
}

describe('ANALYTICS-NO-LOG-LIFT (scan #13, authored in O2.1)', () => {
  it('PLANTED POSITIVE: the column name, the camelCase field, and a select string all fail', () => {
    expect(logLiftViolations('p.ts', 'const v = row.log_lift')).toHaveLength(1)
    expect(logLiftViolations('p.ts', 'const v = row.logLift')).toHaveLength(1)
    expect(logLiftViolations('p.ts', "client.from('post_outcomes').select('post_id, log_lift')")).toHaveLength(1)
  })

  it('PLANTED NEGATIVE: a longer identifier and a comment pass', () => {
    expect(logLiftViolations('n.ts', 'const catalog_lift_x = 1')).toEqual([])
    expect(logLiftViolations('n.ts', '// log_lift is descriptive only')).toEqual([])
  })

  it('REAL TREE: no analytics or report path names log_lift', () => {
    expect(scan(ALL_ROOTS, logLiftViolations)).toEqual([])
  })
})

// ═══ #16 ANALYTICS-AUTHENTICATED-READS, scan half (closes in O2.4) ═══════════════════════════════════════════
// ADR 0031 §9.1: every user-facing read uses the AUTHENTICATED client. The page and component roots may not import
// the service-role factory (the lazy-import pattern lives in lib/db only).

const USER_FACING_ROOTS = ['app/[locale]/(dashboard)/analytics', 'components/analytics'] as const

function serviceClientViolations(rel: string, source: string): string[] {
  return parseImports(source)
    .filter((ref) => /(^|\/)lib\/supabase\/service$/.test(ref.specifier.replace(/^@\//, '')))
    .map((ref) => `${rel}: imports ${ref.specifier}`)
}

describe('ANALYTICS-AUTHENTICATED-READS, scan half (scan #16, authored in O2.1)', () => {
  it('PLANTED POSITIVE: a static, a dynamic and a relative import of the service-role client all fail', () => {
    expect(serviceClientViolations('p.tsx', "import { createServiceRoleClient } from '@/lib/supabase/service'")).toHaveLength(1)
    expect(serviceClientViolations('p.tsx', "const { createServiceRoleClient } = await import('@/lib/supabase/service')")).toHaveLength(1)
    expect(serviceClientViolations('p.tsx', "import { createServiceRoleClient } from '../../../lib/supabase/service'")).toHaveLength(1)
  })

  it('PLANTED NEGATIVE: the authenticated server client and the browser client pass', () => {
    expect(serviceClientViolations('n.tsx', "import { createClient } from '@/lib/supabase/server'")).toEqual([])
    expect(serviceClientViolations('n.tsx', "import { createClient } from '@/lib/supabase/client'")).toEqual([])
  })

  it('REAL TREE: no analytics page or component imports the service-role client', () => {
    expect(scan(USER_FACING_ROOTS, serviceClientViolations)).toEqual([])
  })
})

// ═══ #20 ANALYTICS-CAMPAIGN-VIEW-SINGLE-SOURCE, scan half (closes in O2.5) ═══════════════════════════════════
// ADR 0031 §4.2, §9.2, §12.2 (SHARED-FUNCTION CALLERS). The campaign learning view stays the single campaign
// surface: loadCampaignLearningView keeps its one caller, unavailableMetricsPlatforms stays internal to
// campaign-view.ts (the new surface reads metricsReadAvailableFor instead), and listTopPostMetrics gains no caller.
// WHOLE REPOSITORY, production files only: a new caller anywhere fails, not only in the analytics roots.

const SINGLE_SOURCE_CALLERS: Readonly<Record<string, readonly string[]>> = {
  loadCampaignLearningView: ['lib/outcomes/campaign-view.ts', 'app/[locale]/(dashboard)/campaigns/[id]/page.tsx'],
  unavailableMetricsPlatforms: ['lib/outcomes/campaign-view.ts'],
  listTopPostMetrics: ['lib/db/post-metrics.ts', 'lib/memory/performance.ts'],
}

function singleSourceViolations(rel: string, source: string): string[] {
  const code = stripTsComments(source)
  const offences: string[] = []
  for (const [symbol, allowed] of Object.entries(SINGLE_SOURCE_CALLERS)) {
    if (allowed.includes(rel)) continue
    if (new RegExp(`\\b${symbol}\\b`).test(code)) offences.push(`${rel}: a new user of ${symbol}`)
  }
  return offences
}

describe('ANALYTICS-CAMPAIGN-VIEW-SINGLE-SOURCE, scan half (scan #20, authored in O2.1)', () => {
  it('PLANTED POSITIVE: a second caller of each guarded function fails', () => {
    for (const symbol of Object.keys(SINGLE_SOURCE_CALLERS)) {
      expect(singleSourceViolations('lib/analytics/portfolio.ts', `const v = await ${symbol}(client, id)`), symbol).toHaveLength(1)
    }
    expect(singleSourceViolations('app/[locale]/(dashboard)/analytics/page.tsx', "import { loadCampaignLearningView } from '@/lib/outcomes/campaign-view'")).toHaveLength(1)
  })

  it('PLANTED NEGATIVE: the named callers pass, a different function with a similar name passes, a comment passes', () => {
    expect(singleSourceViolations('app/[locale]/(dashboard)/campaigns/[id]/page.tsx', 'await loadCampaignLearningView(c, b, id, p)')).toEqual([])
    expect(singleSourceViolations('lib/memory/performance.ts', 'await listTopPostMetrics(c, b, 5)')).toEqual([])
    expect(singleSourceViolations('lib/analytics/a.ts', 'await listTopPostMetricsFor(c)')).toEqual([])
    expect(singleSourceViolations('lib/analytics/a.ts', '// do not call listTopPostMetrics')).toEqual([])
  })

  it('STALENESS: each allowed caller still exists and still uses its symbol', () => {
    for (const [symbol, allowed] of Object.entries(SINGLE_SOURCE_CALLERS)) {
      for (const rel of allowed) {
        const abs = path.join(ROOT, rel)
        expect(fs.existsSync(abs), `${rel} no longer exists`).toBe(true)
        expect(new RegExp(`\\b${symbol}\\b`).test(stripTsComments(fs.readFileSync(abs, 'utf8'))), `${rel} no longer uses ${symbol}`).toBe(true)
      }
    }
  })

  it('REAL TREE: no production file outside the named callers uses these three functions', () => {
    const files = collect(ROOT, SKIP_DIRS, isProdTs)
    expect(files.length, 'the repo walk found nothing: the scan is vacuous').toBeGreaterThan(300)
    const offenders = files.flatMap((f) => singleSourceViolations(toRel(f), fs.readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

// ═══ #23 REPORT-MEMBERS-ONLY, scan half (closes in O2.8) ═════════════════════════════════════════════════════
// ADR 0031 §5.4, §9.4: the address an email is enqueued to comes from the member row and nowhere else. The ONE
// recipients function is resolveReportRecipients in lib/db/business-members.ts (service-role, added in O2.8: the
// name is fixed HERE so the scan and the function cannot disagree). An enqueueEmail call in the roots must take
// its `recipient` from a variable bound by iterating that function's result, and nothing may bypass enqueueEmail
// to write the outbox directly.

const RECIPIENTS_FN = 'resolveReportRecipients'

function callArguments(code: string, callee: string): string[] {
  const out: string[] = []
  const needle = new RegExp(`\\b${callee}\\s*\\(`, 'g')
  for (const m of code.matchAll(needle)) {
    let depth = 1
    let i = (m.index ?? 0) + m[0].length
    const start = i
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth += 1
      else if (code[i] === ')') depth -= 1
      i += 1
    }
    out.push(code.slice(start, i - 1))
  }
  return out
}

function recipientDerivedNames(code: string): Set<string> {
  const names = new Set<string>()
  const bound = new Set<string>()
  for (const m of code.matchAll(new RegExp(`\\b(?:const|let)\\s+(\\w+)\\s*=\\s*await\\s+${RECIPIENTS_FN}\\s*\\(`, 'g'))) bound.add(m[1])
  const addBinding = (binding: string) => {
    const destructured = binding.match(/^\{([^}]*)\}$/)
    if (destructured) {
      for (const part of destructured[1].split(',')) {
        const name = part.split(':').pop()?.trim()
        if (name) names.add(name)
      }
    } else if (binding) names.add(binding)
  }
  const sources = ['await\\s+' + RECIPIENTS_FN + '\\s*\\([^)]*\\)', ...[...bound]]
  for (const source of sources) {
    for (const m of code.matchAll(new RegExp(`for\\s*\\(\\s*(?:const|let)\\s+(\\{[^}]*\\}|\\w+)\\s+of\\s+${source}`, 'g'))) addBinding(m[1])
  }
  for (const name of bound) {
    for (const m of code.matchAll(new RegExp(`\\b${name}\\.(?:map|forEach|flatMap)\\(\\s*(?:async\\s*)?\\(?\\s*(\\{[^}]*\\}|\\w+)`, 'g'))) addBinding(m[1])
  }
  return names
}

function recipientViolations(rel: string, source: string): string[] {
  const code = stripTsComments(source)
  const offences: string[] = []
  if (/\binsertEmailOutboxRow\b|['"]email_outbox['"]/.test(code)) offences.push(`${rel}: writes the email outbox directly instead of enqueueEmail`)
  const calls = callArguments(code, 'enqueueEmail')
  if (calls.length === 0) return offences
  const derived = recipientDerivedNames(code)
  if (!new RegExp(`\\b${RECIPIENTS_FN}\\s*\\(`).test(code)) offences.push(`${rel}: enqueueEmail without ${RECIPIENTS_FN}`)
  for (const args of calls) {
    const keyed = args.match(/\brecipient\s*:\s*([^,}\n]+)/)
    const shorthand = /[{,]\s*recipient\s*[,}]/.test(args)
    const expr = keyed ? keyed[1].trim() : shorthand ? 'recipient' : null
    if (expr === null) {
      offences.push(`${rel}: enqueueEmail recipient is not statically sourced`)
      continue
    }
    const root = expr.match(/^[A-Za-z_$][\w$]*/)?.[0]
    if (/['"`@]/.test(expr) || !root || !derived.has(root)) {
      offences.push(`${rel}: enqueueEmail recipient ${expr} is not drawn from ${RECIPIENTS_FN}`)
    }
  }
  return offences
}

describe('REPORT-MEMBERS-ONLY, scan half (scan #23, authored in O2.1)', () => {
  const GOOD = [
    `const members = await ${RECIPIENTS_FN}(businessId)`,
    'for (const member of members) {',
    '  await enqueueEmail({ business_id: businessId, kind: "monthly-report", recipient: member.email, locale, props, dedupe_token: token })',
    '}',
  ].join('\n')

  it('PLANTED POSITIVE: a recipient from the payload, a request, a literal, a spread, a missing resolver call and a direct outbox write all fail', () => {
    const wrap = (recipient: string) => `const members = await ${RECIPIENTS_FN}(b)\nfor (const member of members) {\n  await enqueueEmail({ business_id: b, kind: 'monthly-report', recipient: ${recipient}, locale, props })\n}`
    expect(recipientViolations('p.ts', wrap('payload.email')).length).toBeGreaterThan(0)
    expect(recipientViolations('p.ts', wrap('request.headers.get("x")')).length).toBeGreaterThan(0)
    expect(recipientViolations('p.ts', wrap("'someone@example.com'")).length).toBeGreaterThan(0)
    expect(recipientViolations('p.ts', `const members = await ${RECIPIENTS_FN}(b)\nawait enqueueEmail({ ...input })`).length).toBeGreaterThan(0)
    expect(recipientViolations('p.ts', "await enqueueEmail({ business_id: b, kind: 'monthly-report', recipient: input.to, locale, props })").length).toBeGreaterThan(0)
    expect(recipientViolations('p.ts', "await insertEmailOutboxRow(client, row)").length).toBeGreaterThan(0)
    expect(recipientViolations('p.ts', "await client.from('email_outbox').insert(row)").length).toBeGreaterThan(0)
  })

  it('PLANTED NEGATIVE: a recipient read off the member bound by iterating the resolver passes (for-of, destructured, map)', () => {
    expect(recipientViolations('n.ts', GOOD)).toEqual([])
    expect(
      recipientViolations(
        'n.ts',
        `const rows = await ${RECIPIENTS_FN}(b)\nfor (const { email } of rows) {\n  await enqueueEmail({ business_id: b, kind: 'monthly-report', recipient: email, locale, props })\n}`,
      ),
    ).toEqual([])
    expect(
      recipientViolations(
        'n.ts',
        `const rows = await ${RECIPIENTS_FN}(b)\nawait Promise.all(rows.map((r) => enqueueEmail({ business_id: b, kind: 'monthly-report', recipient: r.email, locale, props })))`,
      ),
    ).toEqual([])
    expect(recipientViolations('n.ts', 'const x = 1')).toEqual([])
  })

  it('REAL TREE: every enqueueEmail call in the roots takes its recipient from the recipients function', () => {
    expect(scan(ALL_ROOTS, recipientViolations)).toEqual([])
  })
})
