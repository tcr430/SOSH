import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0029 §10.3 / build-guide M2.1 — the Tier-3 "properties of absence", written BEFORE any
// lib/interview code they fence (the ADR 0023 G1b.2 precedent). Each scan has TWO halves,
// because a scan that has never failed proves nothing (ADR 0029 §14 [test-1]: a scan without
// its planted pair "does not count"):
//   1. a pure DETECTOR, unit-tested here against a PLANTED POSITIVE and a PLANTED NEGATIVE
//      (this half runs in CI forever, so the scan cannot rot into a vacuous pass); and
//   2. the detector run over the REAL tree, asserting it scanned a non-empty set.
// Tests are excluded from the real-tree scans (they legitimately contain planted strings).
//
// Closes INTERVIEW-WRITES-VIA-LIB-MEMORY (4), INTERVIEW-NO-BUDGET-PURPOSE (32),
// INTERVIEW-NO-EMAIL-KIND (33), INTERVIEW-NO-NEW-CAPABILITY (34), INTERVIEW-NO-NEW-SANITIZER (43).
// INTERVIEW-WRITER-SOLE-CALLER (5) lives in lib/memory/import.test.ts, whose FORBIDDEN alternation
// the ADR names; it is closed there.
// CLOSES INTERVIEW-NO-PERFORMANCE-WRITE (21), INTERVIEW-NO-VOICE-WRITE (23),
// INTERVIEW-NO-UNATTENDED-ACTION (24) — these are ROOT-scoped and close HERE, in M2.11, now that all
// five roots exist (M2.1's authored scan half is unchanged; only the vacuity floor moved). Also
// closed earlier: INTERVIEW-EVIDENCE-PERMISSION-OFF (20, M2.5's Tier-1 half) and
// INTERVIEW-PERFORMANCE-POLICY-UNCHANGED (14, M2.2's Tier-1 re-run).

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '__fixtures__', '.wolf', '.claude'])

function toRel(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

function collect(dir: string, test: (name: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, test, out)
    else if (test(entry.name)) out.push(full)
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

function stripSqlComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

function moduleSpecifiers(source: string): string[] {
  const specs: string[] = []
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) specs.push(m[1])
  return specs
}

function resolveSpecifier(spec: string, fileRel: string): string {
  if (spec.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(fileRel), spec))
  if (spec.startsWith('@/')) return spec.slice(2)
  return spec
}

function migrations(): { name: string; sql: string }[] {
  const dir = path.join(ROOT, 'supabase', 'migrations')
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }))
}

// The last migration that existed when Session 35 branched (BASE bfb3bf72, master 73bc4234).
// "In this range" below means a migration whose file name sorts AFTER this one.
const BOUNDARY_MIGRATION = '20260924100000_apply_brief_proposals_exact_placement.sql'

// ═══ The five ROOTS (ADR 0029 §10.3) ═════════════════════════════════════════
// M2.11: all five roots now exist (lib/memory/interview.ts and lib/db/memory-interview.ts since
// M2.5; app/**/interview/** since M2.10; app/api/cron/interview-sweep/** since M2.9). The floor is
// raised: every root is scanned, none is PENDING. Counting a scan over an empty directory would be
// a FALSE-GREEN (ADR 0015) — the test below now asserts every one of the five is non-empty, not
// just accounted-for-as-pending.
type RootName =
  | 'lib/interview/**'
  | 'lib/memory/interview.ts'
  | 'lib/db/memory-interview.ts'
  | 'app/**/interview/**'
  | 'app/api/cron/interview-sweep/**'

const ALL_ROOTS: RootName[] = [
  'lib/interview/**',
  'lib/memory/interview.ts',
  'lib/db/memory-interview.ts',
  'app/**/interview/**',
  'app/api/cron/interview-sweep/**',
]

// M2.1-M2.10: these were PENDING until M2.11 closed all five roots. Kept as an empty list (not
// deleted) so the "no root silently dropped" assertion below still has something to diff against.
const PENDING_UNTIL_M2_11: RootName[] = []

function appInterviewDirs(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.name === 'interview') out.push(full)
    else appInterviewDirs(full, out)
  }
  return out
}

function rootFiles(root: RootName): string[] {
  switch (root) {
    case 'lib/interview/**':
      return collect(path.join(ROOT, 'lib', 'interview'), isProdTs)
    case 'lib/memory/interview.ts': {
      const f = path.join(ROOT, 'lib', 'memory', 'interview.ts')
      return fs.existsSync(f) ? [f] : []
    }
    case 'lib/db/memory-interview.ts': {
      const f = path.join(ROOT, 'lib', 'db', 'memory-interview.ts')
      return fs.existsSync(f) ? [f] : []
    }
    case 'app/**/interview/**':
      return appInterviewDirs(path.join(ROOT, 'app')).flatMap((d) => collect(d, isProdTs))
    case 'app/api/cron/interview-sweep/**':
      return collect(path.join(ROOT, 'app', 'api', 'cron', 'interview-sweep'), isProdTs)
  }
}

/** The files a root-scoped scan reads today: every root that exists, deduplicated. */
function scannedRootFiles(): { scannedRoots: RootName[]; files: string[] } {
  const scannedRoots = ALL_ROOTS.filter((r) => rootFiles(r).length > 0)
  const files = [...new Set(scannedRoots.flatMap(rootFiles))]
  return { scannedRoots, files }
}

describe('INTERVIEW roots — the vacuity floor for the root-scoped scans (ADR 0029 §10.3)', () => {
  it('M2.11: all FIVE roots are real, non-empty, and scanned — none PENDING, none silently dropped', () => {
    const { scannedRoots, files } = scannedRootFiles()
    for (const root of ALL_ROOTS) {
      expect(rootFiles(root).length, `${root} matched zero files — the scans would pass vacuously`).toBeGreaterThanOrEqual(1)
    }
    expect(scannedRoots).toHaveLength(ALL_ROOTS.length)
    expect(files.length).toBeGreaterThanOrEqual(ALL_ROOTS.length)
    // Every root is either scanned or explicitly pending: none is silently dropped. At M2.11 the
    // pending list is empty, so this reduces to "every root is scanned."
    const accounted = new Set<RootName>([...scannedRoots, ...PENDING_UNTIL_M2_11])
    expect(accounted.size).toBe(ALL_ROOTS.length)
  })
})

// ═══ INTERVIEW-WRITES-VIA-LIB-MEMORY (4) ═════════════════════════════════════
// No `.from('<x>_memory')` outside lib/db/ — repo-wide (app/, lib/, components/), NOT root-scoped.
// The memory-table-boundary.test.ts mechanism, widened to every *_memory table; that file's own
// scan keeps its roots and its constraint (MEM-NO-DIRECT-TABLE-ACCESS is a different ADR's).
// Known blind spot (ADR §10.3): an rpc() name built at runtime.

function findMemoryTableFrom(source: string): string[] {
  const hits: string[] = []
  const re = /\.from\(\s*['"`]([a-z_]*_memory)['"`]/g
  let m: RegExpExecArray | null
  const code = stripTsComments(source)
  while ((m = re.exec(code)) !== null) hits.push(m[1])
  return hits
}

describe('INTERVIEW-WRITES-VIA-LIB-MEMORY (ADR 0029 §2.3, §10.3, constraint 4)', () => {
  it('the detector flags a .from() of any *_memory table (planted violations)', () => {
    expect(findMemoryTableFrom("const r = await client.from('brand_memory').insert(row)")).toEqual(['brand_memory'])
    expect(findMemoryTableFrom('client.from("evidence_memory").update(x)')).toEqual(['evidence_memory'])
    expect(findMemoryTableFrom("client\n  .from(\n    'audience_memory'\n  ).delete()")).toEqual(['audience_memory'])
    expect(findMemoryTableFrom('client.from(`performance_memory`).select()')).toEqual(['performance_memory'])
  })

  it('the detector does NOT flag other tables, rpc() calls, or commented-out code', () => {
    expect(findMemoryTableFrom("client.from('posts').select()")).toEqual([])
    expect(findMemoryTableFrom("client.rpc('write_interview_candidates', args)")).toEqual([])
    expect(findMemoryTableFrom("// client.from('brand_memory').insert(row)")).toEqual([])
    expect(findMemoryTableFrom("/* client.from('brand_memory') */ const x = 1")).toEqual([])
    expect(findMemoryTableFrom("const label = 'brand_memory'")).toEqual([])
  })

  it('no .from(*_memory) exists in app/, lib/ or components/ outside lib/db/', () => {
    const files = ['app', 'lib', 'components']
      .flatMap((d) => collect(path.join(ROOT, d), isProdTs))
      .filter((f) => !toRel(f).startsWith('lib/db/'))
    expect(files.length, 'the scan matched too few files — it would pass vacuously').toBeGreaterThanOrEqual(300)
    const offenders: string[] = []
    for (const file of files) {
      const hits = findMemoryTableFrom(fs.readFileSync(file, 'utf8'))
      if (hits.length > 0) offenders.push(`${toRel(file)} -> ${hits.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})

// ═══ INTERVIEW-NO-BUDGET-PURPOSE (32) ════════════════════════════════════════
// The ai_budget_daily purpose CHECK still has FOUR values (A-4: no fifth purpose). Read from the
// LATEST migration that defines it, so a later widening is what gets caught.
//
// Session 35-D D9 (Reviewer NIT-3): the detector matched only `CHECK (purpose IN (...))`. A widening written as
// `purpose = ANY (ARRAY[...])` — an equivalent, equally valid Postgres CHECK shape — escaped it entirely (the scan would have
// found nothing and, per its own "found === null" assertion below, FAILED LOUD rather than passing vacuously — but a fifth
// purpose added via that shape would never be caught as a violation of BASELINE_PURPOSES). Both forms are now matched,
// case- and whitespace-insensitive.
//
// RESIDUAL BLIND SPOTS (recorded per ADR 0029 §10.3's table format — this scan's row there says "—"; it is not empty):
//   - a CHECK expressed as a DOMAIN (`CREATE DOMAIN ai_budget_purpose AS text CHECK (...)`) applied to the column via its type,
//     rather than a table-level or column-level CHECK naming `purpose` directly;
//   - a purpose value list moved into a separate lookup table with an FK, instead of an inline CHECK;
//   - a value added by altering an EXISTING constraint's body across two migrations in a way that never puts all five values
//     in one CHECK clause the regex can see whole (e.g. `DROP CONSTRAINT` in one migration, a five-value `ADD CONSTRAINT` in a
//     LATER one still IS caught, since "latest" wins; a value added by two overlapping ALTERs in the SAME migration, if
//     Postgres itself would reject that as redefining the same constraint name, is not a real risk).

const BASELINE_PURPOSES = ['backfill_cents', 'generation_posts', 'planner_cents', 'triage_cents']

function latestBudgetPurposes(all: { name: string; sql: string }[]): { migration: string; values: string[] } | null {
  let found: { migration: string; values: string[] } | null = null
  // Both CHECK shapes Postgres accepts for "purpose is one of these": `purpose IN ('a', 'b')` and `purpose = ANY (ARRAY['a', 'b'])`.
  // \s+ throughout (not a literal space) so either form is caught across a line wrap or extra whitespace.
  const IN_FORM = /CHECK\s*\(\s*purpose\s+IN\s*\(([^)]*)\)\s*\)/gi
  const ANY_ARRAY_FORM = /CHECK\s*\(\s*purpose\s*=\s*ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]/gi
  for (const { name, sql } of [...all].sort((a, b) => a.name.localeCompare(b.name))) {
    const code = stripSqlComments(sql)
    if (!/ai_budget_daily/i.test(code)) continue
    for (const re of [IN_FORM, ANY_ARRAY_FORM]) {
      let m: RegExpExecArray | null
      while ((m = re.exec(code)) !== null) {
        const values = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
        found = { migration: name, values }
      }
    }
  }
  return found
}

describe('INTERVIEW-NO-BUDGET-PURPOSE (ADR 0029 §7.3, A-4, constraint 32)', () => {
  it('the detector reads the LATEST definition and returns its values (planted violation: a fifth purpose)', () => {
    const fixture = [
      { name: '20260901000000_a.sql', sql: "ALTER TABLE ai_budget_daily ADD CONSTRAINT c CHECK (purpose IN ('a','b'));" },
      {
        name: '20260930000000_b.sql',
        sql: "ALTER TABLE ai_budget_daily ADD CONSTRAINT c CHECK (purpose IN ('triage_cents', 'generation_posts', 'backfill_cents', 'planner_cents', 'interview_cents'));",
      },
    ]
    const got = latestBudgetPurposes(fixture)
    expect(got?.migration).toBe('20260930000000_b.sql')
    expect(got?.values).toHaveLength(5)
    expect(got?.values).toContain('interview_cents')
  })

  it('the detector ignores commented-out definitions and unrelated CHECKs (planted negative)', () => {
    const fixture = [
      {
        name: '20260901000000_a.sql',
        sql: "ALTER TABLE ai_budget_daily ADD CONSTRAINT c CHECK (purpose IN ('x','y','z','w'));\n-- ALTER TABLE ai_budget_daily ADD CONSTRAINT c CHECK (purpose IN ('1','2','3','4','5'));",
      },
      { name: '20260902000000_b.sql', sql: "ALTER TABLE other ADD CONSTRAINT c CHECK (kind IN ('1','2','3','4','5'));" },
    ]
    expect(latestBudgetPurposes(fixture)?.values).toEqual(['w', 'x', 'y', 'z'])
  })

  // Session 35-D D9 (NIT-3): the `= ANY (ARRAY[...])` shape — a real Postgres CHECK form the old regex never matched at all.
  it('the detector ALSO catches a widening written as `purpose = ANY (ARRAY[...])` (planted positive, the NIT-3 escape)', () => {
    const fixture = [
      { name: '20260901000000_a.sql', sql: "ALTER TABLE ai_budget_daily ADD CONSTRAINT c CHECK (purpose IN ('a','b'));" },
      {
        name: '20260930000000_b.sql',
        sql: "ALTER TABLE ai_budget_daily ADD CONSTRAINT c CHECK (purpose = ANY (ARRAY['triage_cents', 'generation_posts', 'backfill_cents', 'planner_cents', 'interview_cents']));",
      },
    ]
    const got = latestBudgetPurposes(fixture)
    expect(got?.migration).toBe('20260930000000_b.sql')
    expect(got?.values).toHaveLength(5)
    expect(got?.values).toContain('interview_cents')
  })

  it('the ANY(ARRAY) form is caught across a line wrap, mixed case (`Any`, `array`) and extra whitespace (planted positive)', () => {
    const fixture = [
      {
        name: '20260930010000_c.sql',
        sql: "ALTER TABLE ai_budget_daily ADD CONSTRAINT c CHECK (\n  purpose  =  Any (\n    array['triage_cents','generation_posts','backfill_cents','planner_cents','interview_cents']\n  )\n);",
      },
    ]
    expect(latestBudgetPurposes(fixture)?.values).toContain('interview_cents')
  })

  it('an unrelated `= ANY (ARRAY[...])` CHECK on another column, or another table, is ignored (planted negative)', () => {
    const fixture = [
      { name: '20260901000000_a.sql', sql: "ALTER TABLE ai_budget_daily ADD CONSTRAINT c CHECK (purpose IN ('w','x','y','z'));" },
      {
        name: '20260902000000_b.sql',
        sql: "ALTER TABLE ai_budget_daily ADD CONSTRAINT c2 CHECK (status = ANY (ARRAY['1','2','3','4','5']));",
      },
      {
        name: '20260903000000_c.sql',
        sql: "ALTER TABLE other_table ADD CONSTRAINT c CHECK (purpose = ANY (ARRAY['1','2','3','4','5']));",
      },
    ]
    expect(latestBudgetPurposes(fixture)?.values).toEqual(['w', 'x', 'y', 'z'])
  })

  it('the latest real definition has exactly the four baseline purposes (M2.0 premise 9: 20260922110000:428-430)', () => {
    const all = migrations()
    expect(all.length, 'the scan read too few migrations').toBeGreaterThanOrEqual(100)
    const got = latestBudgetPurposes(all)
    expect(got, 'no ai_budget_daily purpose CHECK was found — the scan would pass vacuously').not.toBeNull()
    expect(got?.values).toEqual(BASELINE_PURPOSES)
  })
})

// ═══ INTERVIEW-NO-EMAIL-KIND (33) ════════════════════════════════════════════
// The EmailKind union in lib/email/types.ts still has SIX members (A-5: no seventh kind).

const BASELINE_EMAIL_KINDS = [
  'trial-warning-t3',
  'trial-warning-t1',
  'welcome-to-plan',
  'payment-failed-courtesy',
  'first-post-published',
  'team-invite',
]

function emailKindMembers(source: string): string[] {
  const code = stripTsComments(source)
  const start = code.search(/export\s+type\s+EmailKind\s*=/)
  if (start < 0) return []
  const rest = code.slice(start)
  // End at the next declaration (or `;`), not at a blank line: a stripped comment leaves a
  // whitespace-only line INSIDE the union.
  const nextDecl = rest.slice(1).search(/\n\s*(?:export|type|interface|const|function)\b|;/)
  const end = nextDecl < 0 ? -1 : nextDecl + 1
  const block = end < 0 ? rest : rest.slice(0, end)
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('INTERVIEW-NO-EMAIL-KIND (ADR 0029 §5.5, A-5, constraint 33)', () => {
  it('the detector counts the union members (planted violation: a seventh kind)', () => {
    const seven = "export type EmailKind =\n  | 'a'\n  | 'b'\n  | 'c'\n  | 'd'\n  | 'e'\n  | 'f'\n  | 'interview-reminder'\n\nexport type X = 'z'"
    expect(emailKindMembers(seven)).toHaveLength(7)
    expect(emailKindMembers(seven)).toContain('interview-reminder')
  })

  it('the detector ignores other unions and commented-out members (planted negative)', () => {
    const six = "export type EmailKind =\n  | 'a'\n  | 'b'\n  // | 'commented'\n  | 'c'\n  | 'd'\n  | 'e'\n  | 'f'\n\nexport type EmailLocale = 'en' | 'pt' | 'es'"
    expect(emailKindMembers(six)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(emailKindMembers("export type Other = 'x' | 'y'")).toEqual([])
  })

  it('lib/email/types.ts declares exactly the six baseline kinds', () => {
    const members = emailKindMembers(fs.readFileSync(path.join(ROOT, 'lib', 'email', 'types.ts'), 'utf8'))
    expect(members.length, 'no EmailKind union was found — the scan would pass vacuously').toBeGreaterThanOrEqual(1)
    expect(members).toEqual(BASELINE_EMAIL_KINDS)
  })
})

// ═══ INTERVIEW-NO-NEW-CAPABILITY (34) ════════════════════════════════════════
// user_can's capability list is unchanged and no migration re-creates it (ADR 0029 §2.5:
// answer = `author`; ratify = approver OR is_admin, enforced inside the RPCs).

const BASELINE_CAPABILITIES = ['author', 'reschedule', 'approve', 'connect_accounts', 'manage_members', 'manage_billing']

function definesUserCan(sql: string): boolean {
  return /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?user_can\s*\(/i.test(stripSqlComments(sql))
}

function userCanCapabilities(sql: string): string[] {
  const code = stripSqlComments(sql)
  const start = code.search(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?user_can\s*\(/i)
  if (start < 0) return []
  return [...code.slice(start).matchAll(/WHEN\s+'([a-z_]+)'\s+THEN/g)].map((m) => m[1])
}

describe('INTERVIEW-NO-NEW-CAPABILITY (ADR 0029 §2.5, constraint 34)', () => {
  it('the detector reads the capability list and finds a re-creation (planted violations)', () => {
    const sql = "CREATE OR REPLACE FUNCTION public.user_can(a uuid, b text) RETURNS boolean AS $$ SELECT CASE b WHEN 'author' THEN true WHEN 'ratify_memory' THEN true END $$;"
    expect(definesUserCan(sql)).toBe(true)
    expect(userCanCapabilities(sql)).toEqual(['author', 'ratify_memory'])
    expect(definesUserCan('CREATE FUNCTION user_can(a uuid) RETURNS boolean AS $$ SELECT 1 $$;')).toBe(true)
  })

  it('the detector ignores grants, comments and other functions (planted negative)', () => {
    expect(definesUserCan('GRANT EXECUTE ON FUNCTION public.user_can(uuid, text) TO anon;')).toBe(false)
    expect(definesUserCan('-- CREATE OR REPLACE FUNCTION public.user_can(a uuid) RETURNS boolean')).toBe(false)
    expect(definesUserCan('CREATE OR REPLACE FUNCTION public.user_can_like(a uuid) RETURNS boolean AS $$ SELECT 1 $$;')).toBe(false)
    expect(userCanCapabilities('SELECT 1')).toEqual([])
  })

  it('exactly one migration defines user_can, and its capability list is the six-item baseline', () => {
    const all = migrations()
    expect(all.length, 'the scan read too few migrations').toBeGreaterThanOrEqual(100)
    const definers = all.filter((m) => definesUserCan(m.sql))
    expect(definers.map((m) => m.name)).toEqual(['20260702120200_user_can.sql'])
    expect(userCanCapabilities(definers[0].sql)).toEqual(BASELINE_CAPABILITIES)
  })
})

// ═══ INTERVIEW-NO-NEW-SANITIZER (43) ═════════════════════════════════════════
// The count of `function sanitizeDataField` definitions in production files under lib/ and app/
// is UNCHANGED. The M2.0 BASELINE is FIVE (rubric.ts:9, post-regeneration.ts:9,
// post-generation.ts:8, formats/native-generation-prompt.ts:11, brief.ts:15); the build-guide's
// authoring-time "eight" counted test files and a stale hit — M2.0 re-derived it. The interview
// prompt imports neutralize() from lib/ai/wrap-evidence.ts; it defines no sanitizer of its own.

const SANITIZER_BASELINE = 5

function countSanitizerDefinitions(source: string): number {
  const code = stripTsComments(source)
  return (
    (code.match(/\bfunction\s+sanitizeDataField\b/g) ?? []).length +
    (code.match(/\b(?:const|let|var)\s+sanitizeDataField\s*=/g) ?? []).length
  )
}

describe('INTERVIEW-NO-NEW-SANITIZER (ADR 0029 §6.2, constraint 43)', () => {
  it('the detector counts function and arrow definitions (planted violations)', () => {
    expect(countSanitizerDefinitions('function sanitizeDataField(v: string) { return v }')).toBe(1)
    expect(countSanitizerDefinitions('const sanitizeDataField = (v: string) => v')).toBe(1)
    expect(countSanitizerDefinitions('function sanitizeDataField(a){}\nfunction sanitizeDataField(b){}')).toBe(2)
  })

  it('the detector ignores calls, imports and comments (planted negative)', () => {
    expect(countSanitizerDefinitions('const x = sanitizeDataField(input)')).toBe(0)
    expect(countSanitizerDefinitions("import { neutralize } from '@/lib/ai/wrap-evidence'")).toBe(0)
    expect(countSanitizerDefinitions('// function sanitizeDataField is the weak one')).toBe(0)
    expect(countSanitizerDefinitions('/* function sanitizeDataField(v) {} */')).toBe(0)
  })

  it(`production files under lib/ and app/ define exactly ${SANITIZER_BASELINE} (the M2.0 baseline)`, () => {
    const files = ['lib', 'app'].flatMap((d) => collect(path.join(ROOT, d), isProdTs))
    expect(files.length, 'the scan matched too few files — it would pass vacuously').toBeGreaterThanOrEqual(300)
    const perFile: string[] = []
    let total = 0
    for (const file of files) {
      const n = countSanitizerDefinitions(fs.readFileSync(file, 'utf8'))
      if (n > 0) perFile.push(`${toRel(file)} x${n}`)
      total += n
    }
    expect(total, `definitions found in: ${perFile.join('; ')}`).toBe(SANITIZER_BASELINE)
  })
})

// ═══ INTERVIEW-NO-PERFORMANCE-WRITE (21) — ROOT-scoped, CLOSED in M2.11 (all five roots) ═══
// D-4: no interview code reaches performance_memory. Known blind spot (ADR §10.3): a write routed
// through a generic helper outside the roots.

function findPerformanceWriteTokens(source: string): string[] {
  const code = stripTsComments(source)
  const re = /performance_memory|memory-performance|import_performance_memory|importPerformanceMemory|upsert\w*Performance\w*|Performance\w*Upsert\w*/gi
  return [...code.matchAll(re)].map((m) => m[0])
}

describe('INTERVIEW-NO-PERFORMANCE-WRITE (ADR 0029 §4.7, D-4, constraint 21)', () => {
  it('the detector flags every performance-write token (planted violations)', () => {
    expect(findPerformanceWriteTokens("client.from('performance_memory').insert(x)")).toEqual(['performance_memory'])
    expect(findPerformanceWriteTokens("import { x } from '@/lib/db/memory-performance'")).toEqual(['memory-performance'])
    expect(findPerformanceWriteTokens("client.rpc('import_performance_memory', a)")).toEqual(['import_performance_memory'])
    expect(findPerformanceWriteTokens('await importPerformanceMemory(a)')).toEqual(['importPerformanceMemory'])
    expect(findPerformanceWriteTokens('await upsertDistilledPerformancePattern(a)')).toHaveLength(1)
  })

  it('the detector does NOT flag prose, comments or unrelated names (planted negative)', () => {
    expect(findPerformanceWriteTokens("// never touches performance_memory (D-4)\nconst note = 'performance is learned from published results'")).toEqual([])
    expect(findPerformanceWriteTokens("import { INTERVIEW_CONFIDENCE } from './constants'")).toEqual([])
    expect(findPerformanceWriteTokens('const performanceLexicon = ["reach"]')).toEqual([])
  })

  it('ALL FIVE roots contain no performance-write token', () => {
    const { files, scannedRoots } = scannedRootFiles()
    expect(scannedRoots).toHaveLength(ALL_ROOTS.length)
    expect(files.length).toBeGreaterThanOrEqual(ALL_ROOTS.length)
    const offenders = files.flatMap((f) => findPerformanceWriteTokens(fs.readFileSync(f, 'utf8')).map((t) => `${toRel(f)} -> ${t}`))
    expect(offenders).toEqual([])
  })
})

// ═══ INTERVIEW-NO-VOICE-WRITE (23) — ROOT-scoped, CLOSED in M2.11 (all five roots) ═══
// L-1: an interview answer never writes brand_voices / brand_voice_variations. Known blind spot:
// as above.

function findVoiceWriteTokens(source: string): string[] {
  const code = stripTsComments(source)
  return [...code.matchAll(/brand_voice\w*|upsertBrandVoice|addVariation|create_voice_variation/g)].map((m) => m[0])
}

describe('INTERVIEW-NO-VOICE-WRITE (ADR 0029 §1.2, L-1, constraint 23)', () => {
  it('the detector flags every voice-write token (planted violations)', () => {
    expect(findVoiceWriteTokens("client.from('brand_voices').update(x)")).toEqual(['brand_voices'])
    expect(findVoiceWriteTokens("client.from('brand_voice_variations').insert(x)")).toEqual(['brand_voice_variations'])
    expect(findVoiceWriteTokens('await upsertBrandVoice(a)')).toEqual(['upsertBrandVoice'])
    expect(findVoiceWriteTokens('await addVariation(a)')).toEqual(['addVariation'])
    expect(findVoiceWriteTokens("client.rpc('create_voice_variation', a)")).toEqual(['create_voice_variation'])
  })

  it('the detector does NOT flag brand memory, comments or unrelated names (planted negative)', () => {
    expect(findVoiceWriteTokens("// voice is read through brand_voices elsewhere\nconst kind = 'brand'")).toEqual([])
    expect(findVoiceWriteTokens("import { INTERVIEW_MEMORY_TYPES } from './constants'")).toEqual([])
    expect(findVoiceWriteTokens("const positioning = 'brand positioning'")).toEqual([])
  })

  it('ALL FIVE roots contain no voice-write token', () => {
    const { files, scannedRoots } = scannedRootFiles()
    expect(scannedRoots).toHaveLength(ALL_ROOTS.length)
    expect(files.length).toBeGreaterThanOrEqual(ALL_ROOTS.length)
    const offenders = files.flatMap((f) => findVoiceWriteTokens(fs.readFileSync(f, 'utf8')).map((t) => `${toRel(f)} -> ${t}`))
    expect(offenders).toEqual([])
  })
})

// ═══ INTERVIEW-NO-UNATTENDED-ACTION (24) — ROOT-scoped, CLOSED in M2.11 (all five roots) ═══
// D-5: an answer becomes memory and NOTHING else. Interview roots import nothing from
// lib/campaigns/ or lib/signals/, the brief / card / proposal DB modules, or a brief / card / seed
// creator. Known blind spot (ADR §10.3): a Server Action outside the roots calling both.

const UNATTENDED_DB_MODULES = /^lib\/db\/(?:campaigns|campaign-briefs|campaign-plan-proposals|campaign-retrospectives|insight-cards|signal-candidates|signals)(?:\.|$)/
const UNATTENDED_IDENTIFIERS = /\b(?:assembleBrief|planBrief|createCampaign\w*|seedBrief\w*|seedCampaign\w*|createInsightCard\w*|promoteCandidate\w*)\b/g

function findUnattendedActionRefs(source: string, fileRel: string): string[] {
  const code = stripTsComments(source)
  const hits: string[] = []
  for (const spec of moduleSpecifiers(code)) {
    const resolved = resolveSpecifier(spec, fileRel)
    if (resolved === 'lib/campaigns' || resolved.startsWith('lib/campaigns/')) hits.push(spec)
    else if (resolved === 'lib/signals' || resolved.startsWith('lib/signals/')) hits.push(spec)
    else if (UNATTENDED_DB_MODULES.test(resolved)) hits.push(spec)
  }
  for (const m of code.matchAll(UNATTENDED_IDENTIFIERS)) hits.push(m[0])
  return hits
}

describe('INTERVIEW-NO-UNATTENDED-ACTION (ADR 0029 §1.2, D-5, constraint 24)', () => {
  const rel = 'lib/interview/probe.ts'

  it('the detector flags every import and call shape (planted violations)', () => {
    expect(findUnattendedActionRefs("import { x } from '@/lib/campaigns/brief'", rel)).toEqual(['@/lib/campaigns/brief'])
    expect(findUnattendedActionRefs("import { x } from '@/lib/signals'", rel)).toEqual(['@/lib/signals'])
    expect(findUnattendedActionRefs("import { x } from '../campaigns/plan-brief'", rel)).toEqual(['../campaigns/plan-brief'])
    expect(findUnattendedActionRefs("const m = await import('@/lib/db/insight-cards')", rel)).toEqual(['@/lib/db/insight-cards'])
    expect(findUnattendedActionRefs("import { x } from '@/lib/db/campaign-briefs'", rel)).toEqual(['@/lib/db/campaign-briefs'])
    expect(findUnattendedActionRefs('await assembleBrief(a)', rel)).toEqual(['assembleBrief'])
    expect(findUnattendedActionRefs('await createCampaignAction(a)', rel)).toEqual(['createCampaignAction'])
  })

  it('the detector does NOT flag legitimate imports or commented-out ones (planted negative)', () => {
    expect(findUnattendedActionRefs("import { x } from '@/lib/memory'", rel)).toEqual([])
    expect(findUnattendedActionRefs("import { x } from '@/lib/db/founder-interview-rounds'", rel)).toEqual([])
    expect(findUnattendedActionRefs("import { INTERVIEW_SLOTS } from './constants'", rel)).toEqual([])
    expect(findUnattendedActionRefs("// import { x } from '@/lib/campaigns/brief'", rel)).toEqual([])
    expect(findUnattendedActionRefs("import { x } from '@/lib/campaignsish/y'", rel)).toEqual([])
  })

  it('ALL FIVE roots reach no campaign, signal, brief or card code', () => {
    const { files, scannedRoots } = scannedRootFiles()
    expect(scannedRoots).toHaveLength(ALL_ROOTS.length)
    expect(files.length).toBeGreaterThanOrEqual(ALL_ROOTS.length)
    const offenders = files.flatMap((f) => findUnattendedActionRefs(fs.readFileSync(f, 'utf8'), toRel(f)).map((t) => `${toRel(f)} -> ${t}`))
    expect(offenders).toEqual([])
  })
})

// ═══ INTERVIEW-EVIDENCE-PERMISSION-OFF (20) — scan half; closes M2.5 with its Tier-1 half ═══
// Nothing assigns public_use_permission = true in app/, lib/ OR supabase/migrations/ (ADR 0025
// A-6 counsel gate; L-5). Known blind spot (ADR §10.3): a value computed at runtime — covered by
// the Tier-1 fixed-column test in M2.5.

function findPermissionTrueTs(source: string): string[] {
  const code = stripTsComments(source)
  return [
    ...code.matchAll(/\bpublic_use_permission\s*:\s*true\b/g),
    ...code.matchAll(/\bpublicUsePermission\s*:\s*true\b/g),
    ...code.matchAll(/\.public_use_permission\s*=\s*true\b/g),
  ].map((m) => m[0])
}

function findPermissionTrueSql(source: string): string[] {
  const code = stripSqlComments(source)
  return [...code.matchAll(/\bpublic_use_permission\s*=\s*true\b/gi), ...code.matchAll(/\bSET\s+public_use_permission\b/gi)].map((m) => m[0])
}

describe('INTERVIEW-EVIDENCE-PERMISSION-OFF (ADR 0029 §4.6, L-5, constraint 20) — scan half', () => {
  it('the TS detector flags every assignment shape (planted violations)', () => {
    expect(findPermissionTrueTs('const row = { public_use_permission: true }')).toHaveLength(1)
    expect(findPermissionTrueTs('const row = { publicUsePermission: true }')).toHaveLength(1)
    expect(findPermissionTrueTs('row.public_use_permission = true')).toHaveLength(1)
  })

  it('the TS detector does NOT flag false, comparisons, comments or reads (planted negative)', () => {
    expect(findPermissionTrueTs('const row = { public_use_permission: false }')).toEqual([])
    expect(findPermissionTrueTs('if (row.public_use_permission === true) {}')).toEqual([])
    expect(findPermissionTrueTs('// public_use_permission: true is counsel-gated')).toEqual([])
  })

  it('the SQL detector flags every assignment shape (planted violations)', () => {
    expect(findPermissionTrueSql('UPDATE evidence_memory SET public_use_permission = true WHERE id = $1;')).toHaveLength(2)
    expect(findPermissionTrueSql('UPDATE evidence_memory\n   SET public_use_permission = TRUE;')).toHaveLength(2)
    expect(findPermissionTrueSql('UPDATE evidence_memory SET public_use_permission = v_flag;')).toHaveLength(1)
  })

  it('the SQL detector does NOT flag defaults, false, comments or CHECK text (planted negative)', () => {
    expect(findPermissionTrueSql('public_use_permission boolean NOT NULL DEFAULT false,')).toEqual([])
    expect(findPermissionTrueSql('INSERT INTO evidence_memory (public_use_permission) VALUES (false);')).toEqual([])
    expect(findPermissionTrueSql('-- SET public_use_permission = true would breach the counsel gate')).toEqual([])
  })

  it('no TS in app/ or lib/ and no migration assigns public_use_permission true', () => {
    const ts = ['app', 'lib'].flatMap((d) => collect(path.join(ROOT, d), isProdTs))
    expect(ts.length, 'the TS scan matched too few files — it would pass vacuously').toBeGreaterThanOrEqual(300)
    const all = migrations()
    expect(all.length, 'the SQL scan read too few migrations').toBeGreaterThanOrEqual(100)
    const offenders = [
      ...ts.flatMap((f) => findPermissionTrueTs(fs.readFileSync(f, 'utf8')).map((t) => `${toRel(f)} -> ${t}`)),
      ...all.flatMap((m) => findPermissionTrueSql(m.sql).map((t) => `supabase/migrations/${m.name} -> ${t}`)),
    ]
    expect(offenders).toEqual([])
  })
})

// ═══ INTERVIEW-PERFORMANCE-POLICY-UNCHANGED (14) — scan half; closes M2.2 with its Tier-1 re-run ═══
// No migration in Session 35's range names a performance_memory policy, grant, revoke or trigger
// (ADR 0029 §2.4: that path is Session 33's deliberate, untouched design — ADR 0026 §5.5).
// "In this range" = a file name sorting AFTER BOUNDARY_MIGRATION. At M2.1 the range is EMPTY, so
// the tree run below passes on zero in-range migrations BY CONSTRUCTION; what keeps it honest is
// (a) the planted pair, (b) the boundary file being asserted present, and (c) the in-range count
// being recorded in the failure message. It only starts to bite when M2.2 lands a migration.

function findPerformancePolicyRefs(sql: string): string[] {
  const code = stripSqlComments(sql)
  const hits: string[] = []
  const patterns = [
    /\b(?:CREATE|ALTER|DROP)\s+POLICY\b[^;]*\bperformance_memory\b/gi,
    /\b(?:GRANT|REVOKE)\b[^;]*\bperformance_memory\b/gi,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b[^;]*\bON\s+(?:public\.)?performance_memory\b/gi,
  ]
  for (const p of patterns) for (const m of code.matchAll(p)) hits.push(m[0].replace(/\s+/g, ' ').slice(0, 80))
  return hits
}

describe('INTERVIEW-PERFORMANCE-POLICY-UNCHANGED (ADR 0029 §2.4, constraint 14) — scan half', () => {
  it('the detector flags a policy, grant, revoke or trigger on performance_memory (planted violations)', () => {
    expect(findPerformancePolicyRefs('DROP POLICY performance_memory_insert_own ON public.performance_memory;')).toHaveLength(1)
    expect(findPerformancePolicyRefs('ALTER POLICY performance_memory_insert_own ON public.performance_memory WITH CHECK (true);')).toHaveLength(1)
    expect(findPerformancePolicyRefs('REVOKE INSERT ON public.performance_memory FROM authenticated;')).toHaveLength(1)
    expect(findPerformancePolicyRefs('CREATE TRIGGER t BEFORE UPDATE ON public.performance_memory FOR EACH ROW EXECUTE FUNCTION f();')).toHaveLength(1)
  })

  it('the detector does NOT flag the three interview tables, comments or a bare mention (planted negative)', () => {
    expect(findPerformancePolicyRefs('DROP POLICY brand_memory_insert_own ON public.brand_memory;')).toEqual([])
    expect(findPerformancePolicyRefs('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audience_memory FROM authenticated, anon;')).toEqual([])
    expect(findPerformancePolicyRefs('-- performance_memory is untouched: DROP POLICY performance_memory_insert_own ON public.performance_memory;')).toEqual([])
    expect(findPerformancePolicyRefs('SELECT count(*) FROM public.performance_memory;')).toEqual([])
  })

  // AMENDED (Session 36 L2.2, ADR 0030 §2.4 and founder ruling A-5), in place and never deleted. ADR 0029 froze
  // performance_memory's member policies on purpose; ADR 0030 SUPERSEDES that for this table (SUBSTRATE-MEMBER-WRITE-CLOSED,
  // ADR 0030 §12). The supersession is ONE named migration, allowed EXACTLY: any OTHER migration after the boundary that
  // names a performance_memory policy, grant or trigger still fails this scan, and the allowed file must contain exactly
  // the three DROP POLICYs and the one REVOKE the ADR specifies — nothing more can ride in under the allowance.
  const ADR_0030_CLOSURE_MIGRATION = '20260929110000_performance_memory_member_writes_closed.sql'

  it('no migration after the Session 35 boundary names a performance_memory policy, grant or trigger — except the one ADR 0030 §2.4 closure, allowed exactly', () => {
    const all = migrations()
    expect(all.length, 'the scan read too few migrations').toBeGreaterThanOrEqual(100)
    expect(all.map((m) => m.name), 'the boundary migration is missing — the "in this range" cut is meaningless').toContain(BOUNDARY_MIGRATION)
    const inRange = all.filter((m) => m.name > BOUNDARY_MIGRATION)
    const offenders = inRange
      .filter((m) => m.name !== ADR_0030_CLOSURE_MIGRATION)
      .flatMap((m) => findPerformancePolicyRefs(m.sql).map((t) => `${m.name} -> ${t}`))
    expect(offenders, `scanned ${inRange.length} in-range migration(s)`).toEqual([])

    // the allowance is real (not vacuous) and exact
    const closure = inRange.find((m) => m.name === ADR_0030_CLOSURE_MIGRATION)
    expect(closure, 'the ADR 0030 closure migration is missing — the allowance names a file that does not exist').toBeDefined()
    expect(findPerformancePolicyRefs(closure?.sql ?? '').map((h) => h.split(' ').slice(0, 3).join(' '))).toEqual([
      'DROP POLICY performance_memory_insert_own',
      'DROP POLICY performance_memory_update_own',
      'DROP POLICY performance_memory_delete_own',
      'REVOKE INSERT, UPDATE,',
    ])
  })
})

// ═══ INTERVIEW-WRITER-SOLE-CALLER (5) + the stored-form choke point — MINOR-4 (Session 35-D · D1) ═══
// Session 35 review §1/§5 (MINOR-4): SQL grounding checks the RAW span but stores unchecked
// storedText/storedSpan. Chosen remedy (build-guide §4 ledger): the stored forms are TS-TRUSTED, and
// that trust is made enforceable by pinning BOTH (a) the RPC name to its one caller, and (b) the
// PRODUCTION of storedText/storedSpan (as a payload key sent onward, not a local re-validation copy)
// to that same file's choke point (lib/db/memory-interview.ts:112-122). The control is
// memory-interview.test.ts's own literal RAW-vs-STORED cases ("sends the RAW text and span for the
// SQL containment check and the NEUTRALISED forms for storage", :52-77, and the exact key set at
// :103) — this scan does not re-test that invariant, only that nothing ELSE can produce it.
//
// lib/interview/extract.ts's isStorable() (:106-119) ALSO declares local consts named storedText /
// storedSpan — deliberately: it recomputes the same neutralised length as a PRE-CHECK so an
// oversized/blank stored form is dropped and counted before the writer would abort the whole atomic
// write on it. That is a local, transient re-validation copy, never a payload key, and the detector
// below must not conflate the two: it flags PRODUCTION (an object key or a member assignment), never
// a `const`/`let` declaration. Known blind spot (ADR §10.3, matching this file's other scans): a
// payload key built through computed-property syntax (`[name]: value`) or spread from another object.

function findWriteInterviewCandidatesRpcRefs(source: string): string[] {
  const code = stripTsComments(source)
  return [...code.matchAll(/\bwrite_interview_candidates\b/g)].map((m) => m[0])
}

function findStoredFormProducers(source: string): string[] {
  const code = stripTsComments(source)
  const patterns = [/\bstoredText\s*:/g, /\bstoredSpan\s*:/g, /\.storedText\s*=(?!=)/g, /\.storedSpan\s*=(?!=)/g]
  const hits: string[] = []
  for (const p of patterns) for (const m of code.matchAll(p)) hits.push(m[0].trim())
  return hits
}

function scanScopeFiles(): string[] {
  const { files } = scannedRootFiles()
  const dbFiles = collect(path.join(ROOT, 'lib', 'db'), isProdTs)
  return [...new Set([...files, ...dbFiles])]
}

describe('INTERVIEW-WRITER-SOLE-CALLER + stored-form choke point (ADR 0029 §2.3, MINOR-4, Session 35-D D1)', () => {
  it('the RPC-name detector flags the literal name and ignores comments (planted positive/negative)', () => {
    expect(findWriteInterviewCandidatesRpcRefs("return callInterviewRpc('write_interview_candidates', {})")).toEqual(['write_interview_candidates'])
    expect(findWriteInterviewCandidatesRpcRefs('// the ONLY TypeScript path onto write_interview_candidates')).toEqual([])
  })

  it('the stored-form detector flags a payload key or member assignment, but NOT a local re-validation const (planted positive/negative)', () => {
    expect(findStoredFormProducers('storedText: neutralizeWithSentinels(item.text),')).toEqual(['storedText:'])
    expect(findStoredFormProducers('storedSpan: neutralizeWithSentinels(item.span),')).toEqual(['storedSpan:'])
    expect(findStoredFormProducers('row.storedText = neutralizeWithSentinels(x)')).toEqual(['.storedText ='])
    expect(findStoredFormProducers('row.storedSpan = neutralizeWithSentinels(x)')).toEqual(['.storedSpan ='])
    // the legitimate lib/interview/extract.ts isStorable() shape — a transient re-validation copy, not a producer
    expect(findStoredFormProducers('const storedText = neutralizeWithSentinels(text)\nconst storedSpan = neutralizeWithSentinels(span)')).toEqual([])
    // a read or a comparison is not a producer either
    expect(findStoredFormProducers('if (row.storedText === expected) {}')).toEqual([])
    expect(findStoredFormProducers('// storedText/storedSpan are the neutralised forms')).toEqual([])
  })

  it('write_interview_candidates appears in exactly ONE production file across the five roots + lib/db/: lib/db/memory-interview.ts', () => {
    const files = scanScopeFiles()
    expect(files.length, 'the scan matched too few files — it would pass vacuously').toBeGreaterThanOrEqual(ALL_ROOTS.length)
    const offenders = files.filter((f) => findWriteInterviewCandidatesRpcRefs(fs.readFileSync(f, 'utf8')).length > 0)
    expect(offenders.map(toRel)).toEqual(['lib/db/memory-interview.ts'])
  })

  it('storedText/storedSpan are produced only inside memory-interview.ts\'s choke point (:112-122), never elsewhere in the five roots + lib/db/', () => {
    const files = scanScopeFiles()
    expect(files.length, 'the scan matched too few files — it would pass vacuously').toBeGreaterThanOrEqual(ALL_ROOTS.length)
    const offenders = files.filter((f) => findStoredFormProducers(fs.readFileSync(f, 'utf8')).length > 0)
    expect(offenders.map(toRel)).toEqual(['lib/db/memory-interview.ts'])
  })
})
