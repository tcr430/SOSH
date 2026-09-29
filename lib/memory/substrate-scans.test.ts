import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { MEMORY_WRITERS, RPC_INSERT_TABLES, WRITER_IDS } from './writers'

// ADR 0030 §2.5 / §11.3 (Session 36 L2.1) — the Tier-3 "properties of ABSENCE" for the memory substrate, written
// BEFORE the code they fence (the ADR 0023 G1b.2 precedent), so the session cannot introduce the violation it
// exists to prevent. This file has its OWN describe blocks, roots and vacuity floors. It does NOT edit or widen
// lib/learning/memory-table-boundary.test.ts, lib/memory/import.test.ts or
// lib/campaigns/planner/__tests__/source-scans.test.ts (cerebrum 2026-09-21: never widen another ADR's scan).
// Where it needs their data (arm 4) it READS the file as text.
//
// Every scan has TWO halves: a pure DETECTOR unit-tested against a PLANTED POSITIVE and a PLANTED NEGATIVE, and
// the detector run over the REAL tree asserting it scanned a NUMERICALLY non-empty set. A scan whose root does
// not exist yet is PENDING (`it.skipIf`), which vitest reports as SKIPPED, never as passed: a scan over an empty
// root is a FALSE-GREEN, so it is not counted. Each pending scan names the step that closes it.
//
// REDDEN TRANSCRIPTS: a scan without a pasted redden transcript is AUTHORED, not proven — see the L2.1 commit body.

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '__fixtures__', '.wolf', '.claude'])

const toRel = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/')
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel))
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

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
const isSql = (name: string) => name.endsWith('.sql')

// A single-pass scanner (the outcomes / planner template): block and line comments are removed and, optionally,
// string-literal CONTENTS are blanked, so `'insert('` is not code and a `//` inside a string is not a comment.
function strip(source: string, blankStrings: boolean): string {
  const s = source.replace(/\r\n/g, '\n')
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    const n = s[i + 1]
    if (c === '/' && n === '*') {
      const end = s.indexOf('*/', i + 2)
      i = end === -1 ? s.length : end + 2
      out += ' '
    } else if (c === '/' && n === '/') {
      while (i < s.length && s[i] !== '\n') i += 1
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < s.length && s[j] !== c) {
        if (s[j] === '\\') j += 1
        else if (c !== '`' && s[j] === '\n') break
        j += 1
      }
      const literal = s.slice(i, j + 1)
      out += blankStrings ? `${c}${c}` : literal
      i = j + 1
    } else {
      out += c
      i += 1
    }
  }
  return out
}
const stripComments = (source: string) => strip(source, false)
const stripCode = (source: string) => strip(source, true)

function stripSqlComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

function resolveSpec(spec: string, fileRel: string): string {
  if (spec.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(fileRel), spec))
  if (spec.startsWith('@/')) return spec.slice(2)
  return spec
}

function scanRoot(roots: string[], collectFn: (name: string) => boolean, detector: (src: string, rel: string) => string[]) {
  const files = roots.flatMap((r) => collect(r, collectFn))
  const offenders: string[] = []
  for (const file of files) {
    const hits = detector(fs.readFileSync(file, 'utf8'), toRel(file))
    if (hits.length > 0) offenders.push(`${toRel(file)}: ${hits.join('; ')}`)
  }
  return { files, offenders }
}

const PROD_ROOTS = ['lib', 'app', 'components', 'scripts'].map((d) => path.join(ROOT, d))
const DB_MEMORY_FILE = /^lib\/db\/memory-[a-z]+\.ts$/

// The migrations of THIS session's range: everything after ADR 0029's last (20260929100000_ratify_replace_conflict_bound).
const RANGE_AFTER = '20260929100000'
const rangeMigrations = collect(path.join(ROOT, 'supabase', 'migrations'), isSql).filter(
  (f) => path.basename(f).slice(0, 14) > RANGE_AFTER,
)

// ═══ SUBSTRATE-WRITES-VIA-LIB-MEMORY (5) — four arms, driven by MEMORY_WRITERS ═══════════════════════════════
//
// BLIND SPOTS, recorded rather than pretended away:
//   arm 1  a `.rpc(` inside a NON-exported helper that FOLLOWS an export is attributed to that export; a helper
//          before the first export is reported as '<preamble>'. A writer reached only through a wrapper helper in
//          another file (as callInterviewRpc is) is caught only because that helper's name is listed below.
//   arm 2  a namespace import (`import * as m`) is flagged wholesale; a dynamic import whose result is indexed by a
//          computed key (`m[name]`) is invisible.
//   arm 3  a table name built at runtime (`.from(t)`) is invisible; only the four literal names are caught.
//   arm 4  reads the allow-list as TEXT from the ADR 0027 scan, so a rename of that constant is a loud failure
//          ('allow-list not found'), not a silent pass.

// callInterviewRpc<Result>(...) carries a generic argument, so the call shape allows an optional <...> before the (.
const RPC_CALL_SHAPES = /\.rpc\s*(?:<[^>]*>)?\s*\(|\bcallInterviewRpc\s*(?:<[^>]*>)?\s*\(/

export function findRpcExports(source: string): string[] {
  const code = stripCode(source)
  const starts: Array<{ name: string; at: number }> = []
  const re = /\bexport\s+(?:async\s+)?function\s+(\w+)|\bexport\s+const\s+(\w+)\s*=/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) starts.push({ name: m[1] ?? m[2], at: m.index })
  const hits: string[] = []
  const firstAt = starts.length > 0 ? starts[0].at : code.length
  if (RPC_CALL_SHAPES.test(code.slice(0, firstAt))) hits.push('<preamble>')
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : code.length
    if (RPC_CALL_SHAPES.test(code.slice(s.at, end))) hits.push(s.name)
  })
  return hits
}

const DB_MEMORY_SPEC = /^lib\/db\/memory-(brand|evidence|audience|performance|interview)$/

export function findWrapperImports(source: string, fileRel: string, wrapperNames: readonly string[]): string[] {
  const clean = stripComments(source)
  const code = stripCode(source)
  const hits = new Set<string>()
  const staticRe = /\bimport\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = staticRe.exec(clean)) !== null) {
    if (m[1]) continue // `import type` carries no value
    if (!DB_MEMORY_SPEC.test(resolveSpec(m[3], fileRel))) continue
    const clause = m[2]
    if (/\*\s*as\s+\w+/.test(clause)) hits.add('<namespace import>')
    const braces = /\{([\s\S]*)\}/.exec(clause)
    if (!braces) continue
    for (const part of braces[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (wrapperNames.includes(name)) hits.add(name)
    }
  }
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = dynamicRe.exec(clean)) !== null) {
    if (!DB_MEMORY_SPEC.test(resolveSpec(m[1], fileRel))) continue
    for (const name of wrapperNames) if (new RegExp(`\\b${name}\\b`).test(code)) hits.add(name)
  }
  return [...hits]
}

export function isAllowedCaller(fileRel: string, soleCallerModule: string | null): boolean {
  if (soleCallerModule === null) return false
  return soleCallerModule.endsWith('/') ? fileRel.startsWith(soleCallerModule) : fileRel === soleCallerModule
}

export function findMemoryTableFrom(source: string): string[] {
  const hits: string[] = []
  for (const m of stripComments(source).matchAll(/\.from\(\s*['"](brand|evidence|audience|performance)_memory['"]\s*\)/g)) {
    hits.push(`from('${m[1]}_memory')`)
  }
  return hits
}

export function parseEvidenceAllowList(scanSource: string): string[] | null {
  const m = /export const EVIDENCE_INSERT_FUNCTIONS[^=]*=\s*\[([^\]]*)\]/.exec(scanSource)
  if (!m) return null
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
}

const ALL_WRAPPERS: Array<{ wrapper: string; writer: keyof typeof MEMORY_WRITERS }> = WRITER_IDS.flatMap((id) =>
  [...MEMORY_WRITERS[id].wrappers].map((wrapper) => ({ wrapper, writer: id })),
)

describe('SUBSTRATE-WRITES-VIA-LIB-MEMORY (ADR 0030 §2.5, constraint 5) — detectors', () => {
  it('arm 1 flags an exported function that calls .rpc( or callInterviewRpc( (planted)', () => {
    expect(findRpcExports("export async function rogue() { return client.rpc('x', {}) }")).toEqual(['rogue'])
    expect(findRpcExports("export const viaHelper = async () => callInterviewRpc('x', {})")).toEqual(['viaHelper'])
    expect(findRpcExports("export async function w() { return callInterviewRpc<Result>('x', {}) }")).toEqual(['w'])
    expect(findRpcExports("export async function g() { return client.rpc<Row>('x') }")).toEqual(['g'])
    expect(
      findRpcExports("export async function a() { return 1 }\nexport async function b() { return c.rpc('y') }"),
    ).toEqual(['b'])
    expect(findRpcExports("const h = () => c.rpc('z')\nexport const k = 1")).toEqual(['<preamble>'])
  })

  it('arm 1 ignores a plain read, a comment and a string that merely says .rpc( (planted negatives)', () => {
    expect(findRpcExports("export async function read() { return client.from('t').select('*') }")).toEqual([])
    expect(findRpcExports("// client.rpc('x')\nexport const a = 1")).toEqual([])
    expect(findRpcExports("export const a = 'client.rpc(x)'")).toEqual([])
  })

  it('arm 2 catches a static import, a multi-line import and a dynamic import of a registered wrapper (planted)', () => {
    const names = ['importEvidenceMemory', 'promoteOutcomePattern']
    expect(findWrapperImports("import { importEvidenceMemory } from '@/lib/db/memory-evidence'", 'app/x.ts', names)).toEqual([
      'importEvidenceMemory',
    ])
    expect(
      findWrapperImports("import {\n  other,\n  promoteOutcomePattern as p,\n} from '@/lib/db/memory-performance'", 'app/x.ts', names),
    ).toEqual(['promoteOutcomePattern'])
    expect(
      findWrapperImports("const { importEvidenceMemory } = await import('@/lib/db/memory-evidence')", 'app/x.ts', names),
    ).toEqual(['importEvidenceMemory'])
    expect(findWrapperImports("import * as db from '@/lib/db/memory-evidence'", 'app/x.ts', names)).toEqual(['<namespace import>'])
    expect(findWrapperImports("import { importEvidenceMemory } from './memory-evidence'", 'lib/db/other.ts', names)).toEqual([
      'importEvidenceMemory',
    ])
  })

  it('arm 2 allows a read import, a type-only import, another module and a comment (planted negatives)', () => {
    const names = ['importEvidenceMemory']
    expect(findWrapperImports("import { listEvidenceMemoryCandidates } from '@/lib/db/memory-evidence'", 'app/x.ts', names)).toEqual([])
    expect(findWrapperImports("import type { importEvidenceMemory } from '@/lib/db/memory-evidence'", 'app/x.ts', names)).toEqual([])
    expect(findWrapperImports("import { importEvidenceMemory } from '@/lib/other'", 'app/x.ts', names)).toEqual([])
    expect(findWrapperImports("// import { importEvidenceMemory } from '@/lib/db/memory-evidence'", 'app/x.ts', names)).toEqual([])
  })

  it('arm 2 caller check: an exact file, a directory prefix, and the writerless source', () => {
    expect(isAllowedCaller('lib/memory/import.ts', 'lib/memory/import.ts')).toBe(true)
    expect(isAllowedCaller('lib/memory/interview.ts', 'lib/memory/import.ts')).toBe(false)
    expect(isAllowedCaller('lib/learning/promote.ts', 'lib/learning/')).toBe(true)
    expect(isAllowedCaller('lib/learning-x/promote.ts', 'lib/learning/')).toBe(false)
    expect(isAllowedCaller('app/x.ts', null)).toBe(false)
  })

  it('arm 3 flags a governed-table .from( in any of the four tables (planted)', () => {
    expect(findMemoryTableFrom("client.from('brand_memory').select('*')")).toEqual(["from('brand_memory')"])
    expect(findMemoryTableFrom('await c\n  .from("performance_memory")\n  .insert(x)')).toEqual(["from('performance_memory')"])
    expect(findMemoryTableFrom("a.from('evidence_memory'); b.from('audience_memory')")).toHaveLength(2)
  })

  it('arm 3 ignores other tables, relationship_memory, a comment and a string (planted negatives)', () => {
    expect(findMemoryTableFrom("client.from('posts').select('*')")).toEqual([])
    expect(findMemoryTableFrom("client.from('relationship_memory').select('*')")).toEqual([])
    expect(findMemoryTableFrom("// client.from('brand_memory')")).toEqual([])
    // Known conservative false positive: the table NAME is a string literal, so string contents must be kept, and a
    // string that merely contains the call text (`"x.from('brand_memory')"`) is reported too. Recorded, not hidden.
    expect(findMemoryTableFrom("const s = \"x.from('brand_memory')\"")).toHaveLength(1)
  })

  it('arm 4 parses the ADR 0027 allow-list and reports a missing constant loudly (planted)', () => {
    expect(
      parseEvidenceAllowList("export const EVIDENCE_INSERT_FUNCTIONS: readonly string[] = ['a_fn', 'b_fn']\nexport const X = ['z']"),
    ).toEqual(['a_fn', 'b_fn'])
    expect(parseEvidenceAllowList('export const SOMETHING_ELSE = 1')).toBeNull()
  })
})

describe('SUBSTRATE-WRITES-VIA-LIB-MEMORY (ADR 0030 §2.5, constraint 5) — over the real tree', () => {
  const dbFiles = collect(path.join(ROOT, 'lib', 'db'), (n) => /^memory-[a-z]+\.ts$/.test(n))

  it('arm 1: every exported lib/db/memory-*.ts function that calls an RPC is a registered wrapper, and every wrapper exists', () => {
    expect(dbFiles.length, 'scanned suspiciously few lib/db/memory-*.ts files').toBeGreaterThanOrEqual(5)
    const registered = new Set(ALL_WRAPPERS.map((w) => w.wrapper))
    const found = new Set<string>()
    const unregistered: string[] = []
    for (const file of dbFiles) {
      for (const name of findRpcExports(fs.readFileSync(file, 'utf8'))) {
        found.add(name)
        if (!registered.has(name)) unregistered.push(`${toRel(file)}: ${name}`)
      }
    }
    expect(unregistered).toEqual([])
    // anti-stale: the registry names no wrapper that has gone, and the detector really found the whole set
    expect([...found].sort()).toEqual([...registered].sort())
    expect(found.size, 'the detector found no wrappers — it would pass vacuously').toBeGreaterThanOrEqual(11)
  })

  it('arm 2: each registered wrapper is imported ONLY by its soleCallerModule', () => {
    const wrapperNames = ALL_WRAPPERS.map((w) => w.wrapper)
    const { files, offenders } = scanRoot(PROD_ROOTS, isProdTs, (src, rel) => {
      if (DB_MEMORY_FILE.test(rel)) return []
      const bad: string[] = []
      for (const name of findWrapperImports(src, rel, wrapperNames)) {
        const owner = ALL_WRAPPERS.find((w) => w.wrapper === name)
        const allowed = owner ? isAllowedCaller(rel, MEMORY_WRITERS[owner.writer].soleCallerModule) : false
        if (!allowed) bad.push(`${name} (sole caller: ${owner ? MEMORY_WRITERS[owner.writer].soleCallerModule : 'unregistered'})`)
      }
      return bad
    })
    expect(files.length, 'scanned suspiciously few files').toBeGreaterThan(400)
    expect(offenders).toEqual([])
  })

  it("arm 2 is not vacuous: every writer's soleCallerModule really imports one of its wrappers", () => {
    const wrapperNames = ALL_WRAPPERS.map((w) => w.wrapper)
    for (const id of WRITER_IDS) {
      const spec = MEMORY_WRITERS[id]
      if (spec.soleCallerModule === null) continue
      // AMENDED (Session 36 L2.6): at L2.5 this skipped a writer registered with no wrappers (the dismissal writer's SQL half only). Its TS half is
      // here, so EVERY writer that names a soleCallerModule must also register a wrapper — asserted, not skipped.
      expect(spec.wrappers.length, `${id} names a soleCallerModule but registers no wrapper`).toBeGreaterThan(0)
      const files = spec.soleCallerModule.endsWith('/')
        ? collect(path.join(ROOT, spec.soleCallerModule), isProdTs).map(toRel)
        : [spec.soleCallerModule]
      const imported = files.flatMap((f) => findWrapperImports(read(f), f, wrapperNames))
      expect(imported.length, `${id}: its soleCallerModule imports none of its wrappers`).toBeGreaterThan(0)
    }
  })

  // DRIFT (L2.1, reported, not decided): ADR 0030 §2.5 arm 3 says ANY such call outside lib/db/memory-*.ts is a
  // violation, but scripts/learning-report.ts:122 is a pre-existing operator diagnostic that READS performance_memory
  // directly (select-only, service-role, no writes). It is pinned here EXACTLY, so it cannot grow to a second file, and
  // the test fails if it disappears (anti-stale). Whether the script moves behind lib/db is the founder's call.
  const KNOWN_DIRECT_READS = ["scripts/learning-report.ts: from('performance_memory')"]

  it("arm 3: no .from('<brand|evidence|audience|performance>_memory') outside lib/db/memory-*.ts, except the one pinned script", () => {
    const { files, offenders } = scanRoot(PROD_ROOTS, isProdTs, (src, rel) => (DB_MEMORY_FILE.test(rel) ? [] : findMemoryTableFrom(src)))
    expect(files.length, 'scanned suspiciously few files').toBeGreaterThan(400)
    expect(offenders).toEqual(KNOWN_DIRECT_READS)
    // the detector is live on the tree: the db files DO carry the calls it forbids elsewhere
    const inside = dbFiles.flatMap((f) => findMemoryTableFrom(read(toRel(f))))
    expect(inside.length, 'the detector found no .from( in lib/db/memory-*.ts — it would pass vacuously').toBeGreaterThan(10)
  })

  it("arm 4: ADR 0027's EVIDENCE_INSERT_FUNCTIONS equals the registry's evidence-inserting RPC set", () => {
    const list = parseEvidenceAllowList(read('lib/campaigns/planner/__tests__/source-scans.test.ts'))
    expect(list, 'EVIDENCE_INSERT_FUNCTIONS not found in the ADR 0027 scan').not.toBeNull()
    const registryEvidence = Object.entries(RPC_INSERT_TABLES)
      .filter(([, tables]) => tables.includes('evidence_memory'))
      .map(([rpc]) => rpc)
    expect([...(list ?? [])].sort()).toEqual(registryEvidence.sort())
  })
})

// ═══ AUTHORED HERE, CLOSED LATER ═════════════════════════════════════════════════════════════════════════════

// ─── SUBSTRATE-MEMBER-WRITE-CLOSED (6), scan half · closes L2.2 ──────────────────────────────────────────────
// Blind spot: ALTER POLICY has no FOR clause in Postgres, so ANY ALTER POLICY on a *_memory table is reported (a
// conservative choice: nothing in this range should be altering a memory policy). A GRANT to a role held in a
// variable, or via `GRANT <role> TO authenticated`, is invisible.

export function findMemberWriteViolations(sql: string): string[] {
  const clean = stripSqlComments(sql)
  const hits: string[] = []
  for (const m of clean.matchAll(/\b(create|alter)\s+policy\s+("?[\w]+"?)\s+on\s+(?:public\.)?(\w*_memory)\b([^;]*);/gi)) {
    const verb = m[1].toLowerCase()
    const body = m[4]
    const forMatch = /\bfor\s+(select|insert|update|delete|all)\b/i.exec(body)
    if (verb === 'alter') hits.push(`ALTER POLICY ${m[2]} on ${m[3]} (no FOR clause is possible)`)
    else if (!forMatch) hits.push(`CREATE POLICY ${m[2]} on ${m[3]} has no FOR clause (= ALL)`)
    else if (forMatch[1].toLowerCase() !== 'select') hits.push(`CREATE POLICY ${m[2]} on ${m[3]} FOR ${forMatch[1].toUpperCase()}`)
  }
  for (const m of clean.matchAll(/\bgrant\s+([\w\s,]+?)\s+on\s+(all\s+tables\s+in\s+schema\s+\w+|(?:table\s+)?(?:public\.)?\w+)\s+to\s+([^;]+);/gi)) {
    const privileges = m[1].toLowerCase()
    const target = m[2].toLowerCase()
    const grantees = m[3].toLowerCase()
    const writes = /\b(insert|update|delete|all)\b/.test(privileges)
    const toMember = /\b(authenticated|anon)\b/.test(grantees)
    const onMemory = /_memory\b/.test(target) || /^all\s+tables\s+in\s+schema/.test(target)
    if (writes && toMember && onMemory) hits.push(`GRANT ${m[1].trim()} on ${m[2].trim()} to ${m[3].trim()}`)
  }
  return hits
}

describe('SUBSTRATE-MEMBER-WRITE-CLOSED (ADR 0030 §2.4, constraint 6) — policy/grant scan', () => {
  it('flags a no-FOR policy, FOR ALL, FOR INSERT/UPDATE/DELETE, ALTER POLICY and a write GRANT to a member role (planted)', () => {
    expect(findMemberWriteViolations('CREATE POLICY p ON public.performance_memory USING (true);')).toHaveLength(1)
    expect(findMemberWriteViolations('CREATE POLICY p ON public.brand_memory FOR ALL USING (true);')).toHaveLength(1)
    expect(findMemberWriteViolations('CREATE POLICY p ON evidence_memory FOR INSERT WITH CHECK (true);')).toHaveLength(1)
    expect(findMemberWriteViolations('create policy p on audience_memory for update using (true) with check (true);')).toHaveLength(1)
    expect(findMemberWriteViolations('CREATE POLICY p ON performance_memory FOR DELETE USING (true);')).toHaveLength(1)
    expect(findMemberWriteViolations('ALTER POLICY p ON public.performance_memory USING (true);')).toHaveLength(1)
    expect(findMemberWriteViolations('GRANT INSERT ON public.performance_memory TO authenticated;')).toHaveLength(1)
    expect(findMemberWriteViolations('GRANT ALL ON TABLE public.brand_memory TO anon;')).toHaveLength(1)
    expect(findMemberWriteViolations('GRANT SELECT, UPDATE ON audience_memory TO authenticated, service_role;')).toHaveLength(1)
    expect(findMemberWriteViolations('GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;')).toHaveLength(1)
  })

  it('allows FOR SELECT, REVOKEs, a SELECT grant, a service_role grant, other tables and comments (planted negatives)', () => {
    expect(findMemberWriteViolations('CREATE POLICY p ON public.performance_memory FOR SELECT USING (true);')).toEqual([])
    expect(findMemberWriteViolations('DROP POLICY p ON public.performance_memory;')).toEqual([])
    expect(findMemberWriteViolations('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.performance_memory FROM authenticated, anon;')).toEqual([])
    expect(findMemberWriteViolations('GRANT SELECT ON public.performance_memory TO authenticated;')).toEqual([])
    expect(findMemberWriteViolations('GRANT ALL ON public.performance_memory TO service_role;')).toEqual([])
    expect(findMemberWriteViolations('CREATE POLICY p ON public.posts FOR ALL USING (true);')).toEqual([])
    expect(findMemberWriteViolations('GRANT INSERT ON public.posts TO authenticated;')).toEqual([])
    expect(findMemberWriteViolations('-- CREATE POLICY p ON public.brand_memory FOR ALL USING (true);\nSELECT 1;')).toEqual([])
  })

  // PENDING until this range has a migration (L2.2 lands the first). Skipped, not passed, while the range is empty.
  it.skipIf(rangeMigrations.length === 0)('no migration of this range opens a member write path on a *_memory table', () => {
    const offenders = rangeMigrations.flatMap((f) => findMemberWriteViolations(fs.readFileSync(f, 'utf8')).map((h) => `${toRel(f)}: ${h}`))
    expect(rangeMigrations.length, 'scanned no migrations').toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})

// ─── SUBSTRATE-EXISTING-WRITERS-UNCHANGED (7), absence half · closes L2.11 ──────────────────────────────────
export function readNumericConstants(source: string, namePattern: RegExp): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of stripComments(source).matchAll(/export const (\w+)\s*(?::\s*number\s*)?=\s*(-?\d+(?:\.\d+)?)\b/g)) {
    if (namePattern.test(m[1])) out[m[1]] = Number(m[2])
  }
  return out
}

export function redefinesPromoteFunction(sql: string): string[] {
  const hits: string[] = []
  for (const m of stripSqlComments(sql).matchAll(
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(promote_performance_pattern|promote_outcome_pattern)\b/gi,
  )) {
    hits.push(m[1])
  }
  return hits
}

// LITERALS pinned here, on purpose: a value edited in the constants file AND in this table together is a
// deliberate, reviewed change to ADR 0018 / ADR 0026, not an accident.
const PINNED_PROMOTION_CONSTANTS: Record<string, number> = {
  LEARN_PROMOTION_MIN_OBSERVATIONS: 5,
  LEARN_PROMOTION_MIN_CONFIDENCE: 0.7,
  LEARN_PROMOTION_MIN_DISTINCT_CAMPAIGNS: 2,
  OUTCOME_MIN_N: 10,
  OUTCOME_MIN_DISTINCT_CAMPAIGNS: 3,
}
const PINNED_CONFIDENCE_CONSTANTS: Record<string, number> = { LEARN_CONFIDENCE_K: 2, LEARN_CONFIDENCE_CEILING: 0.95 }

describe('SUBSTRATE-EXISTING-WRITERS-UNCHANGED (ADR 0030 §2.3/§4.3, constraint 7) — promotion-rule absence', () => {
  it('the constant reader finds only matching numeric exports (planted)', () => {
    const src = 'export const LEARN_PROMOTION_MIN_OBSERVATIONS = 5\nexport const OTHER = 9\n// export const LEARN_PROMOTION_X = 1'
    expect(readNumericConstants(src, /^LEARN_PROMOTION_/)).toEqual({ LEARN_PROMOTION_MIN_OBSERVATIONS: 5 })
    expect(readNumericConstants('export const OUTCOME_MIN_N: number = 10', /^OUTCOME_MIN_/)).toEqual({ OUTCOME_MIN_N: 10 })
  })

  it('the redefinition detector flags CREATE [OR REPLACE] FUNCTION of either promote RPC (planted)', () => {
    expect(redefinesPromoteFunction('CREATE OR REPLACE FUNCTION public.promote_performance_pattern(a int) RETURNS void AS $$ $$;')).toEqual([
      'promote_performance_pattern',
    ])
    expect(redefinesPromoteFunction('create function promote_outcome_pattern() returns void as $$ $$;')).toEqual(['promote_outcome_pattern'])
  })

  it('the redefinition detector ignores a call, a comment and other functions (planted negatives)', () => {
    expect(redefinesPromoteFunction("SELECT promote_performance_pattern('x');")).toEqual([])
    expect(redefinesPromoteFunction('-- CREATE OR REPLACE FUNCTION promote_outcome_pattern()\nSELECT 1;')).toEqual([])
    expect(redefinesPromoteFunction('CREATE FUNCTION demote_outcome_pattern() RETURNS void AS $$ $$;')).toEqual([])
  })

  it('LEARN_PROMOTION_* and OUTCOME_MIN_* equal the pinned literals, with no extra and no missing constant', () => {
    const learn = readNumericConstants(read('lib/learning/promote.ts'), /^LEARN_PROMOTION_/)
    const outcome = readNumericConstants(read('lib/outcomes/constants.ts'), /^OUTCOME_MIN_/)
    expect({ ...learn, ...outcome }).toEqual(PINNED_PROMOTION_CONSTANTS)
    expect(Object.keys({ ...learn, ...outcome }).length, 'the reader found no constants — it would pass vacuously').toBe(5)
  })

  it('LEARN_CONFIDENCE_K and LEARN_CONFIDENCE_CEILING equal the pinned literals', () => {
    expect(readNumericConstants(read('lib/learning/promote.ts'), /^LEARN_CONFIDENCE_/)).toEqual(PINNED_CONFIDENCE_CONSTANTS)
  })

  it.skipIf(rangeMigrations.length === 0)('no migration of this range redefines promote_performance_pattern or promote_outcome_pattern', () => {
    const offenders = rangeMigrations.flatMap((f) => redefinesPromoteFunction(fs.readFileSync(f, 'utf8')).map((n) => `${toRel(f)}: ${n}`))
    expect(rangeMigrations.length, 'scanned no migrations').toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})

// ─── SUBSTRATE-CROSS-TYPE-GUARDED (15) and SUBSTRATE-OUTCOME-SEPARATE (16), scan halves · close L2.8 ──────────
// PENDING: lib/memory/bundle.ts does not exist until L2.8.
const BUNDLE = 'lib/memory/bundle.ts'

export function findRenderedMemoryCasts(source: string): string[] {
  return [...stripCode(source).matchAll(/\bas\s+RenderedMemory\b/g)].map(() => 'as RenderedMemory')
}
export function importsBundleModule(source: string, fileRel: string): boolean {
  const clean = stripComments(source)
  for (const m of clean.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) {
    if (resolveSpec(m[1], fileRel) === 'lib/memory/bundle') return true
  }
  return false
}
export function findBundleStringify(source: string): string[] {
  return [...stripCode(source).matchAll(/JSON\.stringify\(\s*[\w.]*[bB]undle\w*/g)].map((m) => m[0])
}
export function findStringBrandParams(source: string): string[] {
  return [...stripCode(source).matchAll(/\b(brandCandidates|audienceCandidates)\??\s*:\s*(?:readonly\s+)?string(?:\[\])?\b/g)].map((m) => m[0])
}
export function findOutcomeReach(source: string): string[] {
  return [
    ...stripCode(source).matchAll(/\b(listOutcomePatterns|listOutcomePatternsForGeneration|retrieveOutcomePatterns|retrieveHypothesisResults)\b/g),
  ].map((m) => m[1])
}

describe('SUBSTRATE-CROSS-TYPE-GUARDED / SUBSTRATE-OUTCOME-SEPARATE (ADR 0030 §5.4/§7.2, constraints 15, 16) — detectors', () => {
  it('flag a RenderedMemory cast, a bundle-module import, a stringified bundle, a string brand param, an outcome reach (planted)', () => {
    expect(findRenderedMemoryCasts('return text as RenderedMemory')).toHaveLength(1)
    expect(importsBundleModule("import { x } from '@/lib/memory/bundle'", 'app/x.ts')).toBe(true)
    expect(importsBundleModule("import { x } from './bundle'", 'lib/memory/index.ts')).toBe(true)
    expect(importsBundleModule("const m = await import('@/lib/memory/bundle')", 'app/x.ts')).toBe(true)
    expect(findBundleStringify('JSON.stringify(bundle)')).toHaveLength(1)
    expect(findBundleStringify('JSON.stringify(memoryBundle, null, 2)')).toHaveLength(1)
    expect(findStringBrandParams('brandCandidates: string[]')).toHaveLength(1)
    expect(findStringBrandParams('audienceCandidates?: string')).toHaveLength(1)
    expect(findOutcomeReach('await retrieveOutcomePatterns(id, {})')).toEqual(['retrieveOutcomePatterns'])
    expect(findOutcomeReach("import { listOutcomePatterns } from '@/lib/db/memory-performance'")).toEqual(['listOutcomePatterns'])
  })

  it('allow the guarded shapes, other stringify targets, other modules and comments (planted negatives)', () => {
    expect(findRenderedMemoryCasts('// x as RenderedMemory\nconst a: RenderedMemory = b')).toEqual([])
    expect(importsBundleModule("import { x } from '@/lib/memory'", 'app/x.ts')).toBe(false)
    expect(importsBundleModule("import { x } from './brand'", 'lib/memory/index.ts')).toBe(false)
    expect(findBundleStringify('JSON.stringify(payload)')).toEqual([])
    expect(findStringBrandParams('brandCandidates: RenderedMemory')).toEqual([])
    expect(findStringBrandParams('audienceCandidates: readonly Row[]')).toEqual([])
    expect(findOutcomeReach('// retrieveOutcomePatterns is separate (ADR 0026)')).toEqual([])
  })

  const pending = !exists(BUNDLE)
  it.skipIf(pending)('`as RenderedMemory` appears ONLY in lib/memory/bundle.ts, and only there', () => {
    const { files, offenders } = scanRoot(PROD_ROOTS, isProdTs, (src, rel) => (rel === BUNDLE ? [] : findRenderedMemoryCasts(src)))
    expect(files.length).toBeGreaterThan(400)
    expect(offenders).toEqual([])
    expect(findRenderedMemoryCasts(read(BUNDLE)).length, 'bundle.ts has no cast — the detector would pass vacuously').toBeGreaterThan(0)
  })
  it.skipIf(pending)('nothing outside lib/memory/ imports the bundle module, and no JSON.stringify takes a bundle', () => {
    const { offenders } = scanRoot(PROD_ROOTS, isProdTs, (src, rel) => {
      const hits: string[] = []
      if (!rel.startsWith('lib/memory/') && importsBundleModule(src, rel)) hits.push('imports lib/memory/bundle')
      hits.push(...findBundleStringify(src))
      return hits
    })
    expect(offenders).toEqual([])
  })
  it.skipIf(pending)('lib/ai/prompts/brief.ts declares no string brand or audience candidate parameter', () => {
    expect(findStringBrandParams(read('lib/ai/prompts/brief.ts'))).toEqual([])
  })
  it.skipIf(pending)('lib/memory/bundle.ts reaches no outcome reader (D-7, ADR 0026 OUTCOME-SEPARATE-RETRIEVAL)', () => {
    expect(findOutcomeReach(read(BUNDLE))).toEqual([])
  })
})

// ─── SUBSTRATE-DISMISS-DETERMINISTIC (18) / SUBSTRATE-NO-MODEL-ON-WRITE (23), scan halves · close L2.6 ────────
// PENDING: lib/memory/dismissal.ts does not exist until L2.6. Guards are the ONLY lib/ai import allowed.
const DISMISSAL = 'lib/memory/dismissal.ts'
const ALLOWED_AI_GUARD_SPECS = new Set(['lib/ai/wrap-evidence'])

export function findModelReach(source: string, fileRel: string): string[] {
  const clean = stripComments(source)
  const code = stripCode(source)
  const hits: string[] = []
  for (const m of clean.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) {
    const resolved = resolveSpec(m[1], fileRel)
    if (m[1].startsWith('@anthropic-ai')) hits.push(`imports ${m[1]}`)
    else if (resolved.startsWith('lib/ai/') && !ALLOWED_AI_GUARD_SPECS.has(resolved)) hits.push(`imports ${resolved}`)
  }
  if (/\bmessages\s*\.\s*create\b/.test(code)) hits.push('messages.create')
  if (/\brunPrompt\b/.test(code)) hits.push('runPrompt')
  if (/['"`]claude-(?:sonnet|opus|haiku|fable)[\w.-]*['"`]/.test(clean)) hits.push('model id literal')
  return hits
}

describe('SUBSTRATE-DISMISS-DETERMINISTIC / SUBSTRATE-NO-MODEL-ON-WRITE (ADR 0030 §6/§8, constraints 18, 23) — detector', () => {
  it('flags an Anthropic import, a lib/ai import other than the guard, messages.create, runPrompt and a model id (planted)', () => {
    expect(findModelReach("import Anthropic from '@anthropic-ai/sdk'", 'lib/memory/dismissal.ts')).toHaveLength(1)
    expect(findModelReach("import { runPrompt } from '@/lib/ai/run'", 'lib/memory/dismissal.ts').length).toBeGreaterThanOrEqual(1)
    expect(findModelReach("import { x } from '@/lib/ai/context'", 'lib/memory/dismissal.ts')).toEqual(['imports lib/ai/context'])
    expect(findModelReach('await client.messages.create({})', 'lib/memory/dismissal.ts')).toEqual(['messages.create'])
    expect(findModelReach("const m = 'claude-sonnet-4-6'", 'lib/memory/dismissal.ts')).toEqual(['model id literal'])
    expect(findModelReach("import { x } from '../ai/context'", 'lib/memory/dismissal.ts')).toEqual(['imports lib/ai/context'])
  })

  it('allows the neutralizeWithSentinels guard import, other modules and comments (planted negatives)', () => {
    expect(findModelReach("import { neutralizeWithSentinels } from '@/lib/ai/wrap-evidence'", 'lib/db/memory-audience.ts')).toEqual([])
    expect(findModelReach("import { x } from '@/lib/db/insight-cards'", 'lib/memory/dismissal.ts')).toEqual([])
    expect(findModelReach("// await client.messages.create({}) — never here\nconst a = 1", 'lib/memory/dismissal.ts')).toEqual([])
  })

  const pending = !exists(DISMISSAL)
  it.skipIf(pending)('lib/memory/dismissal.ts and the lib/db dismissal wrapper reach no model', () => {
    const offenders = [DISMISSAL, 'lib/db/memory-audience.ts'].flatMap((f) => findModelReach(read(f), f).map((h) => `${f}: ${h}`))
    expect(offenders).toEqual([])
  })
})

// ─── SUBSTRATE-ONE-DECISION-WRITER (22), scan half · closes L2.6 ──────────────────────────────────────────────
// The registry has exactly ONE decision-derived source: 'dismissal'. It was 0 at L2.1, when the count was authored; the dismissal writer's
// SQL half is registered in L2.5 (its TS half is L2.6), so the expected count is raised to 1 here — one step earlier than the L2.1 note said,
// because the registry entry is what this scan counts.
// The decision-derived sources ADR 0030 §6.7 names: the one shipped ('dismissal') and every DEFERRED decision surface (brief rejection, post skip,
// reschedule, Studio discard, claim removal). A registry entry with any of these ids other than the one shipped is a second decision writer (L-6).
const DECISION_SOURCES = ['dismissal', 'brief_rejection', 'post_skip', 'reschedule', 'studio_discard', 'claim_removal'] as const
const EXPECTED_DECISION_WRITERS = 1

describe('SUBSTRATE-ONE-DECISION-WRITER (ADR 0030 §6, constraint 22) — registry count', () => {
  it('the registry has exactly the expected number of decision-derived sources (exactly 1: dismissal)', () => {
    const count = WRITER_IDS.filter((id) => (DECISION_SOURCES as readonly string[]).includes(id)).length
    expect(count).toBe(EXPECTED_DECISION_WRITERS)
    expect(EXPECTED_DECISION_WRITERS).toBeLessThanOrEqual(1)
  })
})

// ─── SUBSTRATE-DISMISSAL-SCOPED-CONSUMER (28), scan half · closes L2.9 ────────────────────────────────────────
// PENDING: the dismissal reader does not exist until L2.6/L2.9.
export function findNameReach(source: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(stripCode(source))
}

describe('SUBSTRATE-DISMISSAL-SCOPED-CONSUMER (ADR 0030 §6.8, constraint 28) — detector', () => {
  it('finds a name in code and ignores it in comments and strings (planted)', () => {
    expect(findNameReach('await retrieveSourceDismissals(c, id)', 'retrieveSourceDismissals')).toBe(true)
    expect(findNameReach("import { listSourceDismissalCandidates } from 'x'", 'listSourceDismissalCandidates')).toBe(true)
    expect(findNameReach('// retrieveSourceDismissals is triage-only', 'retrieveSourceDismissals')).toBe(false)
    expect(findNameReach("const s = 'listSourceDismissalCandidates'", 'listSourceDismissalCandidates')).toBe(false)
  })

  const pending = !exists(DISMISSAL)
  it.skipIf(pending)('retrieveSourceDismissals is reached only by triage tools; listSourceDismissalCandidates only by dismissal.ts; bundle.ts by neither', () => {
    const allowedRetrieve = (rel: string) => rel === 'lib/signals/triage/tools.ts' || (rel.startsWith('lib/memory/') && rel !== BUNDLE)
    const allowedList = (rel: string) => rel === DISMISSAL || rel === 'lib/db/memory-audience.ts'
    const { files, offenders } = scanRoot(PROD_ROOTS, isProdTs, (src, rel) => {
      const hits: string[] = []
      if (findNameReach(src, 'retrieveSourceDismissals') && !allowedRetrieve(rel)) hits.push('retrieveSourceDismissals')
      if (findNameReach(src, 'listSourceDismissalCandidates') && !allowedList(rel)) hits.push('listSourceDismissalCandidates')
      return hits
    })
    expect(files.length).toBeGreaterThan(400)
    expect(offenders).toEqual([])
  })
})

// ─── SUBSTRATE-CASCADE-COMPLETE (25), scan half · closes L2.5 ─────────────────────────────────────────────────
export function findCreatedTables(sql: string): string[] {
  return [...stripSqlComments(sql).matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1])
}

describe('SUBSTRATE-CASCADE-COMPLETE (ADR 0030 §10, constraint 25) — scan half', () => {
  it('finds CREATE TABLE in every spelling and ignores comments (planted)', () => {
    expect(findCreatedTables('CREATE TABLE public.foo (a int);')).toEqual(['foo'])
    expect(findCreatedTables('create table if not exists bar (a int);')).toEqual(['bar'])
    expect(findCreatedTables('-- CREATE TABLE baz (a int);\nSELECT 1;')).toEqual([])
    expect(findCreatedTables('ALTER TABLE public.foo ADD COLUMN x int;')).toEqual([])
  })

  it.skipIf(rangeMigrations.length === 0)('every table this range creates has a row in ADR 0010 Amendment 2 §D2.5', () => {
    const adr0010 = read('docs/decisions/0010-legal-surface.md')
    const created = rangeMigrations.flatMap((f) => findCreatedTables(fs.readFileSync(f, 'utf8')))
    expect(rangeMigrations.length, 'scanned no migrations').toBeGreaterThan(0)
    expect(created.filter((t) => !adr0010.includes(`\`${t}\``))).toEqual([])
  })
})

// ─── Supporting tripwires (belong to no SUBSTRATE-* row, so they are not counted) ─────────────────────────────
export function findVectorReferences(text: string): string[] {
  return [...text.matchAll(/\bpgvector\b|\bvector\s*\(|\bembedding/gi)].map((m) => m[0].toLowerCase())
}
export function countSanitizerDefinitions(source: string): number {
  return [...stripCode(source).matchAll(/\bfunction\s+sanitizeDataField\b/g)].length
}
// L2.0 baseline V.1b: five definitions under lib/ and app/ (ADR 0020 §7.4 — the count, not the ordinal, is the rule).
const SANITIZER_BASELINE = 5

describe('L-1 dependency tripwire (no pgvector / vector( / embedding) — supporting, uncounted', () => {
  it('flags pgvector, vector( and embedding in every spelling (planted)', () => {
    expect(findVectorReferences('CREATE EXTENSION vector;')).toEqual([])
    expect(findVectorReferences('CREATE EXTENSION pgvector;')).toEqual(['pgvector'])
    expect(findVectorReferences('ALTER TABLE t ADD COLUMN e vector(1536);')).toEqual(['vector('])
    expect(findVectorReferences('embedding_model text, Embeddings')).toEqual(['embedding', 'embedding'])
  })
  it('allows unrelated text (planted negative)', () => {
    expect(findVectorReferences('a vectorised loop; a vector of numbers')).toEqual([])
  })
  it('package.json names no pgvector or embedding dependency', () => {
    const pkg = read('package.json')
    expect(pkg.includes('"dependencies"'), 'package.json was not read').toBe(true)
    expect(findVectorReferences(pkg)).toEqual([])
  })
  it.skipIf(rangeMigrations.length === 0)('no migration of this range references pgvector, vector( or embedding', () => {
    const offenders = rangeMigrations.flatMap((f) => findVectorReferences(stripSqlComments(fs.readFileSync(f, 'utf8'))).map((h) => `${toRel(f)}: ${h}`))
    expect(rangeMigrations.length, 'scanned no migrations').toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})

describe('sanitizeDataField count tripwire (ADR 0020 §7.4) — supporting, uncounted', () => {
  it('counts function definitions and ignores calls, comments and strings (planted)', () => {
    expect(countSanitizerDefinitions('function sanitizeDataField(v: string) { return v }')).toBe(1)
    expect(countSanitizerDefinitions('const x = sanitizeDataField(y)')).toBe(0)
    expect(countSanitizerDefinitions('// function sanitizeDataField() {}')).toBe(0)
    expect(countSanitizerDefinitions("const s = 'function sanitizeDataField'")).toBe(0)
  })
  it(`the production count equals the L2.0 baseline (${SANITIZER_BASELINE}); a new copy fails, a removed copy needs the baseline updated`, () => {
    const roots = ['lib', 'app'].map((d) => path.join(ROOT, d))
    const files = roots.flatMap((r) => collect(r, isProdTs))
    const total = files.reduce((sum, f) => sum + countSanitizerDefinitions(fs.readFileSync(f, 'utf8')), 0)
    expect(files.length, 'scanned suspiciously few files').toBeGreaterThan(300)
    expect(total).toBe(SANITIZER_BASELINE)
  })
})

// ─── SUBSTRATE-QUERY-MODEL-FIELDS-BOUNDED (11), Tier 3 half · closes L2.7 ─────────────────────────────────────────
// ADR 0030 §3.2 [type-1]: the model-facing query schema has ONE owner (lib/memory/query-hints.ts). A tool file that declares its OWN schema — a
// z.strictObject naming query fields, or a JSON-Schema literal with `properties` carrying them — reopens the gap this closes: an intersection in a
// type does not stop a model setting a field if a duplicated schema still carries it.
// Blind spot: a schema built by a helper function or spread from a constant elsewhere is invisible; only the two tool files are scanned.
export function findLocalQueryContextSchema(source: string): string[] {
  const code = stripComments(source)
  const hits: string[] = []
  if (/\bqueryContextInputSchema\b/.test(code)) hits.push('queryContextInputSchema')
  if (/\bQUERY_CONTEXT_JSON_SCHEMA\s*=\s*\{/.test(code)) hits.push('a QUERY_CONTEXT_JSON_SCHEMA object literal')
  for (const m of code.matchAll(/z\.strictObject\(\{([^}]*)\}\)/g)) {
    if (/\b(?:objective|platform|audience|campaignId|confidenceFloor)\b/.test(m[1])) hits.push('a z.strictObject naming query-context fields')
  }
  for (const m of code.matchAll(/properties:\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)) {
    if (/\b(?:objective|audience)\b/.test(m[1])) hits.push('a JSON-Schema properties block naming objective/audience')
  }
  return hits
}
export function importsSharedQuerySchema(source: string): boolean {
  const code = stripComments(source)
  return /\bmemoryQueryHintsSchema\b/.test(code) && /\bMEMORY_QUERY_HINTS_JSON_SCHEMA\b/.test(code) && /from\s*['"]@\/lib\/memory['"]/.test(code)
}

const MODEL_FACING_TOOL_FILES = ['lib/campaigns/planner/tools.ts', 'lib/signals/triage/tools.ts'] as const

describe('SUBSTRATE-QUERY-MODEL-FIELDS-BOUNDED (ADR 0030 §3.2, constraint 11) — no tool file declares its own query-context schema', () => {
  it('flags a local queryContextInputSchema, a QUERY_CONTEXT_JSON_SCHEMA literal, a z.strictObject of query fields and a properties block naming objective/audience (planted)', () => {
    expect(findLocalQueryContextSchema('export const queryContextInputSchema = z.strictObject({ objective: z.string() })').length).toBeGreaterThanOrEqual(2)
    expect(findLocalQueryContextSchema("const QUERY_CONTEXT_JSON_SCHEMA = { type: 'object', properties: { platform: { type: 'string' } } }")).toContain('a QUERY_CONTEXT_JSON_SCHEMA object literal')
    expect(findLocalQueryContextSchema('const s = z.strictObject({ platform: z.string().optional() })')).toHaveLength(1)
    expect(findLocalQueryContextSchema("const j = { type: 'object', properties: { objective: { type: 'string' }, platform: { type: 'string' } } }")).toHaveLength(1)
  })

  it('allows the shared alias, the empty schema and comments (planted negatives)', () => {
    expect(findLocalQueryContextSchema('const QUERY_CONTEXT_JSON_SCHEMA = MEMORY_QUERY_HINTS_JSON_SCHEMA')).toEqual([])
    expect(findLocalQueryContextSchema('export const emptyInputSchema = z.strictObject({})')).toEqual([])
    expect(findLocalQueryContextSchema('// const queryContextInputSchema = z.strictObject({ objective: z.string() })')).toEqual([])
    expect(findLocalQueryContextSchema("const EMPTY_JSON_SCHEMA = { type: 'object', properties: {} }")).toEqual([])
  })

  it.each(MODEL_FACING_TOOL_FILES)('%s declares no query-context schema of its own, and imports the shared one from lib/memory', (rel) => {
    const src = read(rel)
    expect(findLocalQueryContextSchema(src)).toEqual([])
    expect(importsSharedQuerySchema(src), `${rel} does not import memoryQueryHintsSchema + MEMORY_QUERY_HINTS_JSON_SCHEMA from @/lib/memory`).toBe(true)
  })

  it('importsSharedQuerySchema detects the import and its absence (planted)', () => {
    expect(importsSharedQuerySchema("import { memoryQueryHintsSchema, MEMORY_QUERY_HINTS_JSON_SCHEMA } from '@/lib/memory'")).toBe(true)
    expect(importsSharedQuerySchema("import { retrieveEvidenceMemory } from '@/lib/memory'")).toBe(false)
  })
})
