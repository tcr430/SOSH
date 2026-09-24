import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  AI_PLANNER_MAX_TOOL_CALLS,
  AI_PLANNER_MAX_TURNS,
  AI_PLANNER_MAX_CUMULATIVE_INPUT_TOKENS,
  AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN,
  AI_PLANNER_MAX_CUMULATIVE_OUTPUT_TOKENS,
  AI_PLANNER_MAX_WALL_CLOCK_MS,
  AI_PLANNER_RETRY_BUDGET,
  PLANNER_RESERVATION_CENTS,
  PLANNER_TOOL_NAMES,
} from '../constants'

// ADR 0027 §10.3 / build-guide K2.1 — the Tier-3 "properties of ABSENCE", written BEFORE any planner code they
// fence (the ADR 0023 G1b.2 precedent), so the session cannot introduce the violation it exists to prevent.
// Template: lib/outcomes/__tests__/source-scans.test.ts. Each scan has TWO halves, because a scan that has never
// failed proves nothing:
//   1. a pure DETECTOR, unit-tested against a PLANTED violation (this half runs in CI forever); and
//   2. the detector run over the REAL tree, asserting it scanned a NUMERICALLY non-empty set.
// These scans own their describe blocks, roots and floors. They do NOT widen ADR 0021's SIGNAL3-TOOLS-READ-ONLY
// (ADR 0027 §2.6, [test-Q7]): a break must point a reviewer at ADR 0027, and a later ADR-0021 correction narrowing
// its roots must not silently delete this coverage.
//
// REDDEN TRANSCRIPTS: a scan without a pasted redden transcript is AUTHORED, not proven — see the K2.1 commit
// body for the run of each detector against a planted violation in the real tree.

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '__fixtures__', '.wolf', '.claude'])
const PLANNER_ROOT = path.join(ROOT, 'lib', 'campaigns', 'planner')

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
const isSql = (name: string) => name.endsWith('.sql')

// A single-pass scanner: block comments and line comments are removed, and (optionally) string-literal
// CONTENTS are blanked so `'insert('` is not code. Strings are kept when a detector needs a module specifier.
// A state machine, not chained regexes, so a `//` inside a string and an apostrophe inside a comment cannot
// confuse each other (the lib/signals scan's `//`-only stripper is the weaker form the outcomes template avoids).
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

function moduleSpecifiers(source: string): string[] {
  const specs: string[] = []
  const clean = stripComments(source)
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean)) !== null) specs.push(m[1])
  return specs
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

// ═══ AGENCY-TOOLS-READ-ONLY (1) + AGENCY-NO-WRITE-TOOL (5) ═══════════════════
// The planner root contains no write verb. Own describe, own root (lib/campaigns/planner), own floor.
//
// BLIND SPOTS, recorded rather than pretended away (ADR 0027 §10.3): this scan cannot see
//   - a bracket-notation call:      client['insert'](row)
//   - a computed verb:              client[verb](row)
//   - delegation to a helper OUTSIDE the root that writes (the read-only property rests on WHICH lib/db
//     function a tool imports, not on the tool module's text — ADR 0027 §2.6; K2.4 extends the
//     no-service-role check to every lib/db function a planner tool names).
// A scan bounds accidental regression, not a determined author.

export function findWriteVerbs(source: string): string[] {
  const clean = stripCode(source)
  const hits: string[] = []
  for (const m of clean.matchAll(/\.\s*(insert|upsert|update|delete|rpc)\s*\(/g)) hits.push(`.${m[1]}(`)
  return hits
}

describe('AGENCY-TOOLS-READ-ONLY / AGENCY-NO-WRITE-TOOL (ADR 0027 §2.6, constraints 1 and 5)', () => {
  it('the detector flags every write verb, including the split-variable form (planted violations)', () => {
    expect(findWriteVerbs("await client.from('posts').insert({ a: 1 })")).toEqual(['.insert('])
    expect(findWriteVerbs("await client.from('posts').upsert(rows)")).toEqual(['.upsert('])
    expect(findWriteVerbs("await client.from('posts').update({ a: 1 }).eq('id', id)")).toEqual(['.update('])
    expect(findWriteVerbs("await client.from('posts').delete().eq('id', id)")).toEqual(['.delete('])
    expect(findWriteVerbs("await client.rpc('apply_brief_proposals', {})")).toEqual(['.rpc('])
    expect(findWriteVerbs("const t = client.from('posts')\nawait t\n  .insert(x)")).toEqual(['.insert('])
  })

  it('the detector ignores comments, column names and string literals (planted negatives)', () => {
    expect(findWriteVerbs("// client.from('posts').insert(x)")).toEqual([])
    expect(findWriteVerbs("/* client.from('posts').update(x) */ const a = 1")).toEqual([])
    expect(findWriteVerbs('const a = row.updated_at')).toEqual([])
    expect(findWriteVerbs("const s = 'insert('")).toEqual([])
    expect(findWriteVerbs('const t = `.delete(`')).toEqual([])
    expect(findWriteVerbs("await client.from('posts').select('id').eq('a', 1)")).toEqual([])
  })

  it('DOCUMENTED BLIND SPOTS stay blind — pinned so a future author knows what the scan does not see', () => {
    expect(findWriteVerbs("client['insert'](row)")).toEqual([])
    expect(findWriteVerbs('client[verb](row)')).toEqual([])
  })

  it('lib/campaigns/planner/** contains no write verb', () => {
    const { files, offenders } = scanRoot([PLANNER_ROOT], isProdTs, (src) => findWriteVerbs(src))
    expect(files.length, 'the planner root matched zero files — the scan would pass vacuously').toBeGreaterThanOrEqual(1)
    expect(offenders).toEqual([])
  })
})

// ═══ AGENCY-NO-SERVICE-ROLE-IN-TOOLS (4) — FIRST HALF ════════════════════════
// The planner root never reaches the service-role client, statically OR dynamically. The dynamic
// `await import('@/lib/supabase/service')` form is ESSENTIAL — it is the real shape in this repo
// (lib/db/memory-evidence.ts:74-76 and siblings).

export function findServiceRoleReach(source: string, fileRel: string): string[] {
  const hits: string[] = []
  for (const spec of moduleSpecifiers(source)) {
    const resolved = resolveSpec(spec, fileRel)
    if (resolved === 'lib/supabase/service' || resolved.startsWith('lib/supabase/service/')) hits.push(spec)
  }
  if (/\bcreateServiceRoleClient\b/.test(stripCode(source))) hits.push('createServiceRoleClient identifier')
  return hits
}

describe('AGENCY-NO-SERVICE-ROLE-IN-TOOLS — first half (ADR 0027 §2.6, constraint 4)', () => {
  const rel = 'lib/campaigns/planner/tools.ts'

  it('the detector flags static, relative, alias and DYNAMIC imports of the service-role client (planted)', () => {
    expect(findServiceRoleReach("import { createServiceRoleClient } from '@/lib/supabase/service'", rel)).toContain('@/lib/supabase/service')
    expect(findServiceRoleReach("import { x } from '../../supabase/service'", rel)).toEqual(['../../supabase/service'])
    expect(
      findServiceRoleReach("const { createServiceRoleClient } = await import('@/lib/supabase/service')", rel),
    ).toContain('@/lib/supabase/service')
    expect(findServiceRoleReach("const m = require('@/lib/supabase/service')", rel)).toEqual(['@/lib/supabase/service'])
    expect(findServiceRoleReach('const c = createServiceRoleClient()', rel)).toEqual(['createServiceRoleClient identifier'])
  })

  it('the detector allows the caller-supplied client and other supabase modules, and ignores comments', () => {
    expect(findServiceRoleReach("import type { SupabaseClient } from '@supabase/supabase-js'", rel)).toEqual([])
    expect(findServiceRoleReach("import { createClient } from '@/lib/supabase/server'", rel)).toEqual([])
    expect(findServiceRoleReach("// const { createServiceRoleClient } = await import('@/lib/supabase/service')", rel)).toEqual([])
  })

  it('lib/campaigns/planner/** reaches no service-role client', () => {
    const { files, offenders } = scanRoot([PLANNER_ROOT], isProdTs, findServiceRoleReach)
    expect(files.length, 'the planner root matched zero files — the scan would pass vacuously').toBeGreaterThanOrEqual(1)
    expect(offenders).toEqual([])
  })
})

// ═══ AGENCY-NO-SERVICE-ROLE-IN-TOOLS (4) — SECOND HALF (closes here, K2.4) ═══
// The read-only property rests on WHICH FUNCTION a planner tool imports, not on the tool module's own text
// (ADR 0027 §2.6): lib/db/memory-evidence.ts, memory-audience.ts and others hold a service-role import as a
// SIBLING of the caller-client function the tools actually call (importEvidenceMemory next to
// listEvidenceMemoryCandidates, importAudienceMemory next to listAudienceMemoryCandidates). A file-wide scan
// (the first half, above) cannot see this — it would flag the whole file for a sibling it never reaches. This
// half extracts EACH NAMED FUNCTION'S OWN BODY (brace-counted, not regex-bounded, so a nested `{}` in a
// template literal or object literal doesn't truncate early) and checks only that slice.

// LENGTH-PRESERVING mask: comments and string-literal interiors become spaces (same character COUNT), so an
// index found in the mask points at the identical offset in the ORIGINAL source — unlike stripCode's blanked
// strings, which collapse a string literal down to two characters and therefore cannot be used to slice back
// into the original text. This is what makes it safe to return the function's REAL body (import specifiers,
// string content and all) rather than a comment/string-stripped approximation of it.
function maskForBraceMatching(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]
    const n = source[i + 1]
    if (c === '/' && n === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      out += ' '.repeat(stop - i)
      i = stop
    } else if (c === '/' && n === '/') {
      let j = i
      while (j < source.length && source[j] !== '\n') j += 1
      out += ' '.repeat(j - i)
      i = j
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < source.length && source[j] !== c) {
        if (source[j] === '\\') j += 1
        else if (c !== '`' && source[j] === '\n') break
        j += 1
      }
      const end = Math.min(j + 1, source.length)
      out += ' '.repeat(end - i)
      i = end
    } else {
      out += c
      i += 1
    }
  }
  return out
}

export function extractFunctionBody(source: string, functionName: string): string | null {
  const mask = maskForBraceMatching(source)
  const re = new RegExp(`\\bfunction\\s+${functionName}\\s*\\(`)
  const m = re.exec(mask)
  if (!m) return null
  const openBrace = mask.indexOf('{', m.index)
  if (openBrace === -1) return null
  let depth = 0
  for (let i = openBrace; i < mask.length; i += 1) {
    if (mask[i] === '{') depth += 1
    else if (mask[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openBrace, i + 1)
    }
  }
  return null
}

// Session 34-D D3 (MINOR-6): the (file, function) pairs a planner tool reaches are DERIVED from tools.ts' import
// graph, never hand-listed — a hand list is covered only if someone remembers to extend it, and the old one
// omitted getEvidenceMemoryByIds (reached through wrapEvidenceForPrompt in lib/ai/wrap-evidence.ts).
//
// The derivation, one hop at each boundary:
//   1. tools.ts' own named VALUE imports (never `import type`, never an inline `type X`) from '@/lib/db/*';
//   2. every lib/ai module tools.ts imports: THAT module's named value imports from '@/lib/db/*';
//   3. every '@/lib/memory' / '@/lib/memory/*' name tools.ts imports, followed through lib/memory/index.ts'
//      re-export to the module that defines it: THAT module's named value imports from '@/lib/db/*'.
export function namedValueImports(source: string): Array<{ spec: string; names: string[] }> {
  const out: Array<{ spec: string; names: string[] }> = []
  const clean = stripComments(source)
  const re = /\bimport\s+(?!type\b)\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean)) !== null) {
    const names = m[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && !/^type\s/.test(part))
      .map((part) => part.split(/\s+as\s+/)[0].trim())
    out.push({ spec: m[2], names })
  }
  return out
}

function dbSpecToFile(spec: string): string | null {
  return spec.startsWith('@/lib/db/') ? `lib/${spec.slice('@/lib/'.length)}.ts` : null
}

function readRepo(rel: string): string {
  const full = path.join(ROOT, rel)
  expect(fs.existsSync(full), `${rel} is missing — the derivation would pass vacuously`).toBe(true)
  return fs.readFileSync(full, 'utf8')
}

function dbImportsOf(source: string, into: Map<string, { file: string; fn: string }>): void {
  for (const { spec, names } of namedValueImports(source)) {
    const file = dbSpecToFile(spec)
    if (!file) continue
    for (const fn of names) into.set(`${file}#${fn}`, { file, fn })
  }
}

export function derivePlannerCalledDbFunctions(toolsSource: string): Array<{ file: string; fn: string }> {
  const derived = new Map<string, { file: string; fn: string }>()
  dbImportsOf(toolsSource, derived) // (1)
  for (const { spec, names } of namedValueImports(toolsSource)) {
    if (spec.startsWith('@/lib/ai/')) {
      dbImportsOf(readRepo(`lib/${spec.slice('@/lib/'.length)}.ts`), derived) // (2)
    } else if (spec === '@/lib/memory' || spec.startsWith('@/lib/memory/')) {
      const index = stripComments(readRepo('lib/memory/index.ts'))
      for (const name of names) {
        const re = new RegExp(`export\\s*\\{[^}]*\\b(?:\\w+\\s+as\\s+)?${name}\\b[^}]*\\}\\s*from\\s*['"]\\./(\\w+)['"]`)
        const target = re.exec(index)
        if (target) dbImportsOf(readRepo(`lib/memory/${target[1]}.ts`), derived) // (3)
      }
    }
  }
  return [...derived.values()].sort((a, b) => `${a.file}#${a.fn}`.localeCompare(`${b.file}#${b.fn}`))
}

describe('AGENCY-NO-SERVICE-ROLE-IN-TOOLS — second half (ADR 0027 §2.6, constraint 4, closes here)', () => {
  it('extractFunctionBody isolates a named function from its service-role-using siblings (planted)', () => {
    const source = `
      export async function readOne(client) { return client.from('t').select('*') }
      export async function writeOne() { const { createServiceRoleClient } = await import('@/lib/supabase/service') }
    `
    const body = extractFunctionBody(source, 'readOne')
    expect(body).not.toBeNull()
    expect(body).not.toContain('createServiceRoleClient')
    const siblingBody = extractFunctionBody(source, 'writeOne')
    expect(siblingBody).toContain('createServiceRoleClient')
  })

  it('reports null for a function name that is not present (planted negative)', () => {
    expect(extractFunctionBody('export async function a() { return 1 }', 'doesNotExist')).toBeNull()
  })

  it('namedValueImports keeps value imports and drops `import type` and inline `type X` specifiers (planted)', () => {
    const source = `
      import { a, type B, c as d } from '@/lib/db/x'
      import type { E } from '@/lib/db/y'
      import { f } from '@/lib/other'
    `
    expect(namedValueImports(source)).toEqual([
      { spec: '@/lib/db/x', names: ['a', 'c'] },
      { spec: '@/lib/other', names: ['f'] },
    ])
  })

  it('every lib/db function a planner tool reaches — DERIVED from the import graph — has a body, and that body reaches no service-role client', () => {
    const PLANNER_CALLED_DB_FUNCTIONS = derivePlannerCalledDbFunctions(readRepo('lib/campaigns/planner/tools.ts'))
    expect(PLANNER_CALLED_DB_FUNCTIONS.length, 'the derivation found nothing — it would pass vacuously').toBeGreaterThan(0)
    const derivedIds = PLANNER_CALLED_DB_FUNCTIONS.map((f) => `${f.file}#${f.fn}`)
    // MINOR-6: reached through wrapEvidenceForPrompt (lib/ai/wrap-evidence.ts), absent from the old hand list;
    // plus the six the hand list did name — the derivation must be a SUPERSET of what was hand-verified.
    for (const expected of [
      'lib/db/memory-evidence.ts#getEvidenceMemoryByIds',
      'lib/db/memory-evidence.ts#listEvidenceMemoryCandidates',
      'lib/db/memory-audience.ts#listAudienceMemoryCandidates',
      'lib/db/memory-brand.ts#listBrandMemoryCandidates',
      'lib/db/campaigns.ts#listCampaigns',
      'lib/db/signals.ts#getSignalForCampaign',
      'lib/db/posts.ts#listRecentPublishedPostTexts',
    ]) {
      expect(derivedIds, `the derived set lost ${expected}`).toContain(expected)
    }

    const offenders: string[] = []
    for (const { file, fn } of PLANNER_CALLED_DB_FUNCTIONS) {
      const full = path.join(ROOT, file)
      expect(fs.existsSync(full), `${file} is missing — the scan would pass vacuously`).toBe(true)
      const source = fs.readFileSync(full, 'utf8')
      const body = extractFunctionBody(source, fn)
      if (body === null) {
        // Not a `function` declaration. The only thing allowed is a plain VALUE export (a constant such as
        // MEMORY_CANDIDATE_LIMIT — it has no client to acquire); an arrow/function-expression const is a
        // function this extractor cannot read, so it FAILS rather than being skipped.
        const decl = new RegExp(`export\\s+const\\s+${fn}\\b([^\\n]*)`).exec(source)
        expect(decl, `${file}#${fn} is neither a function declaration nor an exported const — the extractor or the derivation drifted`).not.toBeNull()
        expect(/=>|\bfunction\b/.test((decl as RegExpExecArray)[1]), `${file}#${fn} is a function expression the body scan cannot read`).toBe(false)
        expect(findServiceRoleReach(source.slice((decl as RegExpExecArray).index, (decl as RegExpExecArray).index + 400), file)).toEqual([])
        continue
      }
      const hits = findServiceRoleReach(body as string, file)
      if (hits.length > 0) offenders.push(`${file}#${fn}: ${hits.join('; ')}`)
    }
    expect(offenders).toEqual([])
  })
})

// ═══ AGENCY-NO-EGRESS-IN-TOOLS (6) ═══════════════════════════════════════════
// No fetch, no HTTP client, no URL construction, and no social provider under the planner root. A generation tool
// that could reach an ADR 0028 provider would put a write capability on the irreversible row of ADR 0027 §10.5's
// grid, and a fetch tool is a new SSRF surface inside a path that now mutates a brief (ADR 0027 §2.3).

const HTTP_CLIENT_MODULES = new Set([
  'axios',
  'got',
  'ky',
  'undici',
  'node-fetch',
  'cross-fetch',
  'superagent',
  'http',
  'https',
  'node:http',
  'node:https',
  'net',
  'node:net',
  'ws',
])

export function findEgress(source: string, fileRel: string): string[] {
  const hits: string[] = []
  const code = stripCode(source)
  if (/(?<![.\w])fetch\s*\(/.test(code) || /\.fetch\s*\(/.test(code)) hits.push('fetch(')
  if (/\bnew\s+URL\s*\(/.test(code)) hits.push('new URL(')
  if (/\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b/.test(code)) hits.push('browser network constructor')
  for (const spec of moduleSpecifiers(source)) {
    const resolved = resolveSpec(spec, fileRel)
    if (HTTP_CLIENT_MODULES.has(spec)) hits.push(`HTTP client import ${spec}`)
    else if (/^@octokit\//.test(spec) || spec === 'octokit') hits.push(`GitHub client import ${spec}`)
    else if (resolved === 'lib/social' || resolved.startsWith('lib/social/')) hits.push(`social provider import ${spec}`)
  }
  return hits
}

describe('AGENCY-NO-EGRESS-IN-TOOLS (ADR 0027 §2.3, constraint 6)', () => {
  const rel = 'lib/campaigns/planner/tools.ts'

  it('the detector flags fetch, URL construction, HTTP clients and social providers (planted)', () => {
    expect(findEgress("const r = await fetch('https://example.com')", rel)).toEqual(['fetch('])
    expect(findEgress('const r = await globalThis.fetch(url)', rel)).toEqual(['fetch('])
    expect(findEgress('const u = new URL(input)', rel)).toEqual(['new URL('])
    expect(findEgress("import axios from 'axios'", rel)).toEqual(['HTTP client import axios'])
    expect(findEgress("const https = require('node:https')", rel)).toEqual(['HTTP client import node:https'])
    expect(findEgress("import { Octokit } from '@octokit/rest'", rel)).toEqual(['GitHub client import @octokit/rest'])
    expect(findEgress("import { publish } from '@/lib/social'", rel)).toEqual(['social provider import @/lib/social'])
    expect(findEgress("import { x } from '@/lib/social/providers/linkedin'", rel)).toEqual([
      'social provider import @/lib/social/providers/linkedin',
    ])
  })

  it('the detector ignores comments, strings and identifiers that merely contain the word', () => {
    expect(findEgress("// await fetch('https://example.com')", rel)).toEqual([])
    expect(findEgress("const s = 'fetch('", rel)).toEqual([])
    expect(findEgress('await prefetch(x); await refetch(y); const f = row.fetchedAt', rel)).toEqual([])
    expect(findEgress("import { x } from '@/lib/memory'", rel)).toEqual([])
  })

  it('lib/campaigns/planner/** makes no network call and imports no HTTP client or provider', () => {
    const { files, offenders } = scanRoot([PLANNER_ROOT], isProdTs, findEgress)
    expect(files.length, 'the planner root matched zero files — the scan would pass vacuously').toBeGreaterThanOrEqual(1)
    expect(offenders).toEqual([])
  })
})

// ═══ AGENCY-QUERY-CONTEXT-NOT-A-PREDICATE (7) ════════════════════════════════
// MemoryQueryContext's objective/platform/audience are model-supplied free strings feeding an in-process JS
// scoring comparison. They must NEVER reach a PostgREST predicate: the DB read is a fixed business-scoped
// candidate scan and scoring happens after (lib/memory/evidence.ts:18-19). Pushing the filter into the query
// would turn a scoring hint into an injectable predicate (ADR 0027 §2.4).
//   half 1 — the lib/db candidate readers do not even NAME the query context;
//   half 2 — the lib/memory retrieval functions call those readers WITHOUT passing it.

const QUERY_CONTEXT_WORDS = /\b(?:queryContext|MemoryQueryContext|objective|audience|platform)\b/

export function findQueryContextInDbReader(source: string): string[] {
  const code = stripCode(source)
  const hits: string[] = []
  if (/\b(?:queryContext|MemoryQueryContext)\b/.test(code)) hits.push('names the query context')
  return hits
}

export function findQueryContextPassedToCandidateRead(source: string): string[] {
  const code = stripCode(source)
  const hits: string[] = []
  for (const m of code.matchAll(/\blist\w*Candidates\s*\(([^)]*)\)/g)) {
    if (QUERY_CONTEXT_WORDS.test(m[1])) hits.push(`candidate read passed context: (${m[1].trim()})`)
  }
  return hits
}

const MEMORY_DB_READERS = ['lib/db/memory-evidence.ts', 'lib/db/memory-brand.ts', 'lib/db/memory-audience.ts']
const MEMORY_RETRIEVERS = ['lib/memory/evidence.ts', 'lib/memory/brand.ts', 'lib/memory/audience.ts']

describe('AGENCY-QUERY-CONTEXT-NOT-A-PREDICATE (ADR 0027 §2.4, constraint 7)', () => {
  it('the detectors flag a query context reaching a DB reader or a candidate read (planted)', () => {
    expect(findQueryContextInDbReader('function f(client, id, queryContext: MemoryQueryContext) {}')).toEqual([
      'names the query context',
    ])
    expect(
      findQueryContextPassedToCandidateRead('await listEvidenceMemoryCandidates(client, businessId, queryContext)'),
    ).toHaveLength(1)
    expect(
      findQueryContextPassedToCandidateRead('await listBrandMemoryCandidates(client, businessId, { platform })'),
    ).toHaveLength(1)
  })

  it('the detectors allow the fixed business-scoped scan and ignore comments (planted negatives)', () => {
    expect(findQueryContextPassedToCandidateRead('await listEvidenceMemoryCandidates(client, businessId, limit)')).toEqual([])
    expect(findQueryContextInDbReader('// queryContext is scored AFTER the read\nconst x = 1')).toEqual([])
  })

  it('the three lib/db candidate readers never name the query context', () => {
    const files = MEMORY_DB_READERS.map((r) => path.join(ROOT, r))
    for (const f of files) expect(fs.existsSync(f), `${toRel(f)} is missing — the scan would pass vacuously`).toBe(true)
    const offenders = files.flatMap((f) => findQueryContextInDbReader(fs.readFileSync(f, 'utf8')).map((h) => `${toRel(f)}: ${h}`))
    expect(offenders).toEqual([])
  })

  it('the three lib/memory retrievers call their candidate reader without the query context', () => {
    const files = MEMORY_RETRIEVERS.map((r) => path.join(ROOT, r))
    let calls = 0
    const offenders: string[] = []
    for (const f of files) {
      expect(fs.existsSync(f), `${toRel(f)} is missing — the scan would pass vacuously`).toBe(true)
      const src = fs.readFileSync(f, 'utf8')
      calls += [...stripCode(src).matchAll(/\blist\w*Candidates\s*\(/g)].length
      for (const h of findQueryContextPassedToCandidateRead(src)) offenders.push(`${toRel(f)}: ${h}`)
    }
    expect(calls, 'no candidate read was found — the scan would pass vacuously').toBeGreaterThanOrEqual(3)
    expect(offenders).toEqual([])
  })
})

// ═══ AGENCY-NO-ELEVENTH-DIMENSION (22) ═══════════════════════════════════════
// lib/ai/prompts/rubric.ts's ten dimensions are fixed and have three-plus callers (ADR 0027 §4.7). Claim
// verification is a deterministic post-generation check, not a scored dimension. The ten are pinned in BOTH
// places they are spelled: the Zod output schema and the prompt's description block.

export const RUBRIC_DIMENSIONS: readonly string[] = [
  'specificity',
  'originality',
  'evidenceSufficiency',
  'audienceRelevance',
  'platformNativeness',
  'brandVoiceAlignment',
  'openingStrength',
  'ctaFit',
  'unsupportedClaimsRisk',
  'redundancy',
]

export function extractRubricSchemaDimensions(source: string): string[] {
  const clean = stripComments(source)
  const block = /dimensions:\s*z\.object\(\{([\s\S]*?)\}\)/.exec(clean)
  if (!block) return ['<dimensions block not found>']
  return [...block[1].matchAll(/(\w+):\s*dimensionSchema/g)].map((m) => m[1])
}

export function extractRubricPromptDimensions(source: string): string[] {
  const block = /const DIMENSION_DESCRIPTIONS = `([\s\S]*?)`/.exec(source.replace(/\r\n/g, '\n'))
  if (!block) return ['<DIMENSION_DESCRIPTIONS block not found>']
  return [...block[1].matchAll(/^- (\w+):/gm)].map((m) => m[1])
}

describe('AGENCY-NO-ELEVENTH-DIMENSION (ADR 0027 §4.7, constraint 22)', () => {
  const schema = (extra: string) => `const RubricOutputSchema = z.object({
    dimensions: z.object({
      ${RUBRIC_DIMENSIONS.map((d) => `${d}: dimensionSchema,`).join('\n      ')}
      ${extra}
    }),
  })`
  const prompt = (extra: string) =>
    `const DIMENSION_DESCRIPTIONS = \`${RUBRIC_DIMENSIONS.map((d) => `- ${d}: x`).join('\n')}${extra}\``

  it('the extractors read the ten, and see an eleventh in either place (planted)', () => {
    expect(extractRubricSchemaDimensions(schema(''))).toEqual([...RUBRIC_DIMENSIONS])
    expect(extractRubricSchemaDimensions(schema('claimSupport: dimensionSchema,'))).toHaveLength(11)
    expect(extractRubricPromptDimensions(prompt(''))).toEqual([...RUBRIC_DIMENSIONS])
    expect(extractRubricPromptDimensions(prompt('\n- claimSupport: x'))).toHaveLength(11)
  })

  it('the extractors report a missing block instead of passing vacuously', () => {
    expect(extractRubricSchemaDimensions('export const x = 1')).toEqual(['<dimensions block not found>'])
    expect(extractRubricPromptDimensions('export const x = 1')).toEqual(['<DIMENSION_DESCRIPTIONS block not found>'])
  })

  it('lib/ai/prompts/rubric.ts carries exactly the ten dimensions, in order, in the schema AND the prompt', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib', 'ai', 'prompts', 'rubric.ts'), 'utf8')
    expect(extractRubricSchemaDimensions(source)).toEqual([...RUBRIC_DIMENSIONS])
    expect(extractRubricPromptDimensions(source)).toEqual([...RUBRIC_DIMENSIONS])
    expect(RUBRIC_DIMENSIONS).toHaveLength(10)
  })
})

// ═══ AGENCY-NO-EVIDENCE-WRITE-SURFACE (24) ═══════════════════════════════════
// The set of writers to evidence_memory is exactly import_evidence_memory, reached through
// lib/db/memory-evidence.ts. "Cite existing evidence" SELECTS; it never creates (ADR 0027 §4.8, founder A-9).
// L-1 forbids new memory writers and no creation surface exists (§1.4). Three halves:
//   (a) TS — only the two named files touch a write path to evidence_memory (exact, anti-stale);
//   (b) migrations — every INSERT INTO evidence_memory sits inside import_evidence_memory;
//   (c) this session's surfaces — no create-shaped affordance under the planner, campaign or approvals trees.

export function findEvidenceWritePath(source: string): string[] {
  const code = stripCode(source)
  const clean = stripComments(source)
  const hits: string[] = []
  if (/\.from\(\s*['"]evidence_memory['"]\s*\)(?!\s*\.select\s*\()/.test(clean)) hits.push("from('evidence_memory') not followed by .select(")
  if (/\.rpc\(\s*['"][^'"]*evidence[^'"]*['"]/.test(clean)) hits.push('rpc naming evidence')
  if (/\bimportEvidenceMemory\b/.test(code)) hits.push('importEvidenceMemory')
  return hits
}

export const EVIDENCE_WRITER_FILES: readonly string[] = ['lib/db/memory-evidence.ts', 'lib/memory/import.ts']

export function evidenceInsertFunctions(sql: string): string[] {
  const clean = stripSqlComments(sql)
  const names: string[] = []
  for (const m of clean.matchAll(/insert\s+into\s+(?:public\.)?evidence_memory\b/gi)) {
    const before = clean.slice(0, m.index)
    const fns = [...before.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)/gi)]
    names.push(fns.length > 0 ? fns[fns.length - 1][1] : '<outside any function>')
  }
  return names
}

export function findEvidenceCreateAffordance(source: string): string[] {
  const code = stripCode(source)
  const hits: string[] = []
  for (const re of [/\bimportEvidenceMemory\b/, /\bimport_evidence_memory\b/, /\b(?:create|insert|add|save)Evidence\w*\b/]) {
    const m = re.exec(code)
    if (m) hits.push(m[0])
  }
  if (/['"]evidence_memory['"]/.test(stripComments(source))) hits.push("names the 'evidence_memory' table")
  return hits
}

describe('AGENCY-NO-EVIDENCE-WRITE-SURFACE (ADR 0027 §4.8, constraint 24)', () => {
  it('the TS detector flags every evidence write shape (planted)', () => {
    expect(findEvidenceWritePath("await client.from('evidence_memory').insert(row)")).not.toEqual([])
    expect(findEvidenceWritePath("await client.from('evidence_memory')\n  .upsert(row)")).not.toEqual([])
    expect(findEvidenceWritePath("await client.from('evidence_memory').update({ status: 'active' })")).not.toEqual([])
    expect(findEvidenceWritePath("await client.rpc('import_evidence_memory', {})")).not.toEqual([])
    expect(findEvidenceWritePath('await importEvidenceMemory({ businessId })')).not.toEqual([])
  })

  it('the TS detector allows a plain read and ignores comments (planted negatives)', () => {
    expect(findEvidenceWritePath("await client.from('evidence_memory').select('*').eq('business_id', id)")).toEqual([])
    expect(findEvidenceWritePath("// await importEvidenceMemory(x) via client.rpc('import_evidence_memory')")).toEqual([])
  })

  it('the migration detector names the enclosing function of each INSERT (planted)', () => {
    const sql = `CREATE OR REPLACE FUNCTION public.import_evidence_memory(a int) RETURNS void AS $$ BEGIN
      INSERT INTO public.evidence_memory (a) VALUES (1); END; $$;
      CREATE FUNCTION public.rogue_writer() RETURNS void AS $$ BEGIN
      INSERT INTO evidence_memory (a) VALUES (2); END; $$;`
    expect(evidenceInsertFunctions(sql)).toEqual(['import_evidence_memory', 'rogue_writer'])
    expect(evidenceInsertFunctions('INSERT INTO public.evidence_memory (a) VALUES (1);')).toEqual(['<outside any function>'])
    expect(evidenceInsertFunctions('-- INSERT INTO public.evidence_memory (a) VALUES (1);\nSELECT 1;')).toEqual([])
  })

  it('the affordance detector flags a create-shaped name or table access on a surface (planted)', () => {
    expect(findEvidenceCreateAffordance('await importEvidenceMemory(x)')).toContain('importEvidenceMemory')
    expect(findEvidenceCreateAffordance('function createEvidence() {}')).toContain('createEvidence')
    expect(findEvidenceCreateAffordance("client.from('evidence_memory')")).toContain("names the 'evidence_memory' table")
    expect(findEvidenceCreateAffordance('const list = listEvidence(); // never createEvidence')).toEqual([])
  })

  it('production TS touches a write path to evidence_memory ONLY in the two named files, and in BOTH of them', () => {
    const { files, offenders } = scanRoot(
      ['lib', 'app', 'components', 'scripts'].map((d) => path.join(ROOT, d)),
      isProdTs,
      (src) => findEvidenceWritePath(src),
    )
    expect(files.length, 'scanned suspiciously few files').toBeGreaterThan(200)
    const writers = offenders.map((o) => o.split(':')[0])
    expect([...writers].sort()).toEqual([...EVIDENCE_WRITER_FILES].sort())
  })

  it('every INSERT INTO evidence_memory in a migration sits inside import_evidence_memory', () => {
    const migrations = collect(path.join(ROOT, 'supabase', 'migrations'), isSql)
    expect(migrations.length, 'scanned suspiciously few migrations').toBeGreaterThan(50)
    const names = migrations.flatMap((f) => evidenceInsertFunctions(fs.readFileSync(f, 'utf8')))
    expect(names.length, 'no evidence_memory INSERT was found — the detector would pass vacuously').toBeGreaterThanOrEqual(4)
    expect(names.filter((n) => n !== 'import_evidence_memory')).toEqual([])
  })

  it('no planner, campaign or approvals surface carries a create-shaped evidence affordance', () => {
    const roots = [
      path.join(ROOT, 'lib', 'campaigns'),
      path.join(ROOT, 'app', '[locale]', '(dashboard)', 'campaigns'),
      path.join(ROOT, 'app', '[locale]', '(dashboard)', 'approvals'),
    ]
    const { files, offenders } = scanRoot(roots, isProdTs, (src) => findEvidenceCreateAffordance(src))
    expect(files.length, 'scanned suspiciously few files').toBeGreaterThan(10)
    expect(offenders).toEqual([])
  })
})

// ═══ AGENCY-NO-SEVENTH-SANITIZER (39) ════════════════════════════════════════
// ADR 0020 §7.4 stands: the guard is the existing neutralizeWithSentinels, imported, never copied. The existing
// executable forbids scan lib/signals/** ONLY (lib/signals/no-sixth-sanitizer.test.ts), so nothing forbade a
// sixth copy under lib/campaigns/** (ADR 0027 §6.3). This scan runs over the WHOLE production tree and pins the
// five known weak copies EXACTLY — a sixth anywhere fails, and a removed copy fails until the list is updated.

export function findSanitizerDefinitions(source: string): string[] {
  const code = stripCode(source)
  const hits: string[] = []
  if (/\bfunction\s+sanitizeDataField\b/.test(code)) hits.push('function sanitizeDataField')
  if (/\b(?:const|let|var)\s+sanitizeDataField\s*=/.test(code)) hits.push('sanitizeDataField binding')
  return hits
}

export const KNOWN_SANITIZE_DATA_FIELD_COPIES: readonly string[] = [
  'lib/ai/prompts/brief.ts',
  'lib/ai/prompts/formats/native-generation-prompt.ts',
  'lib/ai/prompts/post-generation.ts',
  'lib/ai/prompts/post-regeneration.ts',
  'lib/ai/prompts/rubric.ts',
]

describe('AGENCY-NO-SEVENTH-SANITIZER (ADR 0027 §6.3, constraint 39)', () => {
  it('the detector flags a function or binding definition, and ignores calls and comments (planted)', () => {
    expect(findSanitizerDefinitions('function sanitizeDataField(v: string) { return v }')).toEqual(['function sanitizeDataField'])
    expect(findSanitizerDefinitions('export const sanitizeDataField = (v: string) => v')).toEqual(['sanitizeDataField binding'])
    expect(findSanitizerDefinitions('const x = sanitizeDataField(angle)')).toEqual([])
    expect(findSanitizerDefinitions('// function sanitizeDataField is the weak one')).toEqual([])
  })

  it('exactly the five known copies exist in production code — a sixth anywhere fails, and so does a stale entry', () => {
    const { files, offenders } = scanRoot(
      ['lib', 'app', 'components', 'scripts'].map((d) => path.join(ROOT, d)),
      isProdTs,
      (src) => findSanitizerDefinitions(src),
    )
    expect(files.length, 'scanned suspiciously few files').toBeGreaterThan(200)
    expect(offenders.map((o) => o.split(':')[0]).sort()).toEqual([...KNOWN_SANITIZE_DATA_FIELD_COPIES].sort())
    expect(KNOWN_SANITIZE_DATA_FIELD_COPIES).toHaveLength(5)
  })
})

// ═══ AGENCY-NO-SECOND-BUDGET-TABLE (43) ══════════════════════════════════════
// QUAL-NO-SECOND-BUDGET-TABLE already forbids it; ADR 0027 §7.4 adds a fourth PURPOSE to ai_budget_daily rather
// than a table. Every table created (or renamed) with "budget" in its name across ALL migrations is pinned.

export function budgetTableNames(sql: string): string[] {
  const clean = stripSqlComments(sql)
  const names: string[] = []
  for (const m of clean.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w*budget\w*)"?/gi)) names.push(m[1].toLowerCase())
  // Only a TABLE rename: `ALTER TRIGGER ... RENAME TO trg_..._budget_...` and constraint/index renames are not tables.
  for (const m of clean.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?[\w."]+\s+rename\s+to\s+"?(\w*budget\w*)"?/gi)) {
    names.push(m[1].toLowerCase())
  }
  return names
}

// signal_triage_budget was created by the ADR 0021 migration and renamed to ai_budget_daily by
// 20260909110000_ai_budget_daily_rename.sql. Anything else is a second budget table.
export const BUDGET_TABLE_ALLOWLIST: readonly string[] = ['ai_budget_daily', 'signal_triage_budget']

describe('AGENCY-NO-SECOND-BUDGET-TABLE (ADR 0027 §7.4, constraint 43)', () => {
  it('the detector flags a created or renamed budget table (planted)', () => {
    expect(budgetTableNames('CREATE TABLE public.planner_budget (id uuid);')).toEqual(['planner_budget'])
    expect(budgetTableNames('create table if not exists planner_cents_budget_daily (id uuid);')).toEqual(['planner_cents_budget_daily'])
    expect(budgetTableNames('ALTER TABLE public.x RENAME TO y_budget;')).toEqual(['y_budget'])
  })

  it('the detector ignores comments and non-budget tables (planted negatives)', () => {
    expect(budgetTableNames('-- CREATE TABLE public.planner_budget (id uuid);\nSELECT 1;')).toEqual([])
    expect(budgetTableNames('CREATE TABLE public.campaign_plan_proposals (id uuid);')).toEqual([])
    expect(budgetTableNames('ALTER TRIGGER t ON public.x RENAME TO trg_x_budget_updated_at;')).toEqual([])
  })

  it('across every migration the budget tables are exactly the allowlist', () => {
    const migrations = collect(path.join(ROOT, 'supabase', 'migrations'), isSql)
    expect(migrations.length, 'scanned suspiciously few migrations').toBeGreaterThan(50)
    const names = new Set(migrations.flatMap((f) => budgetTableNames(fs.readFileSync(f, 'utf8'))))
    expect([...names].sort()).toEqual([...BUDGET_TABLE_ALLOWLIST].sort())
  })
})

// ═══ AGENCY-LOOP-SCHEMA-STRICT (11) — Tier 3 half (added K2.2) ════════════════
// ADR 0021 §7.4: the ABSENCE of a `status` field in TriageDecisionSchema is the control that stops "approved"
// being a value the model can emit; ADR 0027 §3.1 makes every schema passed to runToolLoop inherit that duty.
// The Tier-2 half (lib/ai/tool-runner-generic.test.ts) rejects such a schema at loop entry; this half scans the
// decision schemas THEMSELVES, so the violation reddens in CI before any run reaches the guard. Roots are the
// loop and its two consumers.

const VERDICT_SHAPED_FIELD = /(?:^|[\s,{])(applied|status|approved|verified)\s*:/

export function findVerdictShapedSchemaFields(source: string): string[] {
  const clean = stripComments(source)
  const hits: string[] = []
  for (const m of clean.matchAll(/z\.strictObject\(\{([\s\S]*?)\}\)/g)) {
    const field = VERDICT_SHAPED_FIELD.exec(m[1])
    if (field) hits.push(`z.strictObject carries a verdict-shaped field: ${field[1]}`)
  }
  return hits
}

export function countStrictObjectSchemas(source: string): number {
  return [...stripComments(source).matchAll(/z\.strictObject\(\{/g)].length
}

describe('AGENCY-LOOP-SCHEMA-STRICT — Tier 3 half (ADR 0027 §3.1, constraint 11)', () => {
  it('the detector flags each verdict-shaped field in a strictObject (planted)', () => {
    for (const f of ['applied', 'status', 'approved', 'verified']) {
      expect(findVerdictShapedSchemaFields(`const S = z.strictObject({ reason: z.string(), ${f}: z.boolean() })`)).toHaveLength(1)
    }
    expect(findVerdictShapedSchemaFields('const S = z.strictObject({\n  status: z.enum(["a"]),\n})')).toHaveLength(1)
  })

  it('the detector ignores clean schemas, comments, and words that merely contain a forbidden one (planted negatives)', () => {
    expect(findVerdictShapedSchemaFields('const S = z.strictObject({ verdict: z.string(), reason: z.string() })')).toEqual([])
    expect(findVerdictShapedSchemaFields('const S = z.strictObject({ reason: z.string() }) // no status field, by design')).toEqual([])
    expect(findVerdictShapedSchemaFields('const S = z.strictObject({ approvedBy: z.string(), statusText: z.string() })')).toEqual([])
  })

  it('no decision schema under the loop or its consumers carries a verdict-shaped field, and the scan saw at least one', () => {
    const roots = [
      path.join(ROOT, 'lib', 'ai', 'tool-runner.ts'),
      path.join(ROOT, 'lib', 'signals', 'triage'),
      PLANNER_ROOT,
      // K2.7 — the planner's own decision schema lives with its prompt family, outside PLANNER_ROOT. Without this
      // root the ONE schema this constraint exists to police would be the one the scan never opened.
      path.join(ROOT, 'lib', 'ai', 'prompts', 'campaign-planner.ts'),
    ]
    const files = roots.flatMap((r) => (r.endsWith('.ts') ? [r] : collect(r, isProdTs)))
    const strictObjects = files.reduce((n, f) => n + countStrictObjectSchemas(fs.readFileSync(f, 'utf8')), 0)
    expect(strictObjects, 'no z.strictObject decision schema was found — the scan would pass vacuously').toBeGreaterThanOrEqual(1)
    const offenders = files.flatMap((f) => findVerdictShapedSchemaFields(fs.readFileSync(f, 'utf8')).map((h) => `${toRel(f)}: ${h}`))
    expect(offenders).toEqual([])
  })
})

// ═══ AGENCY-TOOL-RESULT-BRANDED (38) — the cast scan (added K2.3) ═════════════
// ADR 0027 §6.2: WITHOUT THIS SCAN THE BRAND IS DECORATION. Two honesty caveats, recorded where the scan lives
// (they are also at the brand's minting site, lib/ai/wrap-evidence.ts):
//   1. a branded string still drops into ANY template-literal hole with no error, brand or no brand;
//   2. a bare `as RenderedToolResult` cast is compile-legal.
// The brand kills STRUCTURAL FORGERY; it does not kill a cast. So the cast is closed here: no cast to
// RenderedToolResult, ToolResultId or GuardedJson (the type whose narrowing is the whole point) outside the
// module that mints them. The precedent is lib/signals/source-scans.test.ts:385-406 (RenderedSignalText).
// Blind spot: a cast through an alias (`type X = RenderedToolResult; ... as X`) — the scan bounds accidental
// regression, not a determined author.

// RenderedEvidence and RenderedSignalText are included (typescript-reviewer, K2.3 finding 2): both are members of
// GuardedJson, and the weak `_brand` string-literal RenderedEvidence in particular would otherwise be the one way
// to mint an accepted-by-tsc string with a cast the scan could not see.
const BRANDED_TOOL_RESULT_TYPES = '(?:RenderedToolResult|ToolResultId|GuardedJson|RenderedEvidence|RenderedSignalText)'

export function findBrandCasts(source: string): string[] {
  const code = stripCode(source)
  const hits: string[] = []
  // `as <any type expression that mentions a brand>` — catches `as Record<string, GuardedJson>`,
  // `as readonly GuardedJson[]` and `as { [k: string]: GuardedJson }`, not only the bare `as Brand` (finding 6).
  for (const m of code.matchAll(new RegExp(`\\bas\\s+[^;,)\\n=<]*?\\b${BRANDED_TOOL_RESULT_TYPES}\\b`, 'g'))) hits.push(m[0])
  // …and the generic form, where a comma is legitimately inside the brackets: `as Record<string, GuardedJson>`.
  for (const m of code.matchAll(new RegExp(`\\bas\\s+\\w+<[^>\\n]*\\b${BRANDED_TOOL_RESULT_TYPES}\\b`, 'g'))) hits.push(m[0])
  // An aliasing import (`import { RenderedToolResult as R }`) would hide a later `as R` from the scan.
  for (const m of stripComments(source).matchAll(new RegExp(`\\b${BRANDED_TOOL_RESULT_TYPES}\\s+as\\s+\\w+`, 'g'))) hits.push(m[0])
  // A legacy angle-bracket cast `<Brand>value`, but NOT a generic argument: `Promise<GuardedJson>`, `useX<GuardedJson>(`
  // follow an identifier or `>`/`]`/`)`, a cast never does.
  for (const m of code.matchAll(new RegExp(`(?<![\\w>\\])])<${BRANDED_TOOL_RESULT_TYPES}>\\s*[\\w(\\[{'"\`]`, 'g'))) hits.push(m[0])
  return hits
}

export const BRAND_MINTING_MODULE = 'lib/ai/wrap-evidence.ts'

describe('AGENCY-TOOL-RESULT-BRANDED — cast scan, Tier 3 half (ADR 0027 §6.2, constraint 38)', () => {
  it('the detector flags every cast shape to a tool-result brand (planted)', () => {
    expect(findBrandCasts("const r = raw as RenderedToolResult")).toEqual(['as RenderedToolResult'])
    expect(findBrandCasts("const r = raw as unknown as RenderedToolResult")).toContain('as unknown as RenderedToolResult')
    expect(findBrandCasts("const id = row.id as ToolResultId")).toEqual(['as ToolResultId'])
    expect(findBrandCasts("const j = value as GuardedJson")).toEqual(['as GuardedJson'])
    expect(findBrandCasts("const r = <RenderedToolResult>raw")).toHaveLength(1)
    expect(findBrandCasts("return { evidence: '' as RenderedToolResult }")).toEqual(['as RenderedToolResult'])
    // the members of GuardedJson that are NOT the new brands (finding 2)
    expect(findBrandCasts("const e = `[DATA]\\n${raw}\\n[/DATA]` as RenderedEvidence")).toEqual(['as RenderedEvidence'])
    expect(findBrandCasts('const s = raw as RenderedSignalText')).toEqual(['as RenderedSignalText'])
    // composite target types that mention a brand (finding 6)
    expect(findBrandCasts('const j = v as Record<string, GuardedJson>')).toHaveLength(1)
    expect(findBrandCasts('const j = v as readonly GuardedJson[]')).toHaveLength(1)
    expect(findBrandCasts('const j = v as { [k: string]: GuardedJson }')).toHaveLength(1)
    // an aliasing import would hide a later `as R`
    expect(findBrandCasts("import { RenderedToolResult as R } from '@/lib/ai/wrap-evidence'")).toEqual(['RenderedToolResult as R'])
  })

  it('the detector allows a type annotation, an import, and other brands, and ignores comments and strings (planted negatives)', () => {
    expect(findBrandCasts("import type { RenderedToolResult } from '@/lib/ai/wrap-evidence'")).toEqual([])
    expect(findBrandCasts('const r: RenderedToolResult = wrapToolResultForPrompt(x)')).toEqual([])
    expect(findBrandCasts('const rows: Array<Record<string, RenderedToolResult>> = []')).toEqual([])
    // generic arguments are NOT casts (finding 6's false positives, which would push authors toward aliases)
    expect(findBrandCasts('async function f(): Promise<GuardedJson> {\n  return null\n}')).toEqual([])
    expect(findBrandCasts('const x = useThing<GuardedJson>(a)')).toEqual([])
    expect(findBrandCasts('type Row = { id: ToolResultId; s: RenderedToolResult }')).toEqual([])
    expect(findBrandCasts('const r = x as string; const t: GuardedJson = null')).toEqual([])
    expect(findBrandCasts('// never `as RenderedToolResult` outside wrap-evidence.ts')).toEqual([])
    expect(findBrandCasts("const s = 'as GuardedJson'")).toEqual([])
  })

  it('no cast to a tool-result brand exists outside the minting module, and the module DOES mint them (anti-stale)', () => {
    const { files, offenders } = scanRoot(
      ['lib', 'app', 'components', 'scripts'].map((d) => path.join(ROOT, d)),
      isProdTs,
      (src, rel) => (rel === BRAND_MINTING_MODULE ? [] : findBrandCasts(src)),
    )
    expect(files.length, 'scanned suspiciously few files').toBeGreaterThan(200)
    expect(offenders).toEqual([])

    const minting = fs.readFileSync(path.join(ROOT, BRAND_MINTING_MODULE), 'utf8')
    expect(findBrandCasts(minting).length, 'the minting module no longer casts — the brand was renamed or moved; update this scan').toBeGreaterThanOrEqual(2)
  })
})

// ═══ AGENCY-PLANNER-PROPOSES-ONLY (25) — Tier 3 half (added K2.7) ══════════════
// ADR 0027 §5.10: the planner writes ONLY proposal rows. The sole writer of brief content is the K2.6 apply RPC,
// behind a human. Own describe, own root (lib/campaigns/planner), own floor.
//
// The write-verb scan above cannot see this: the planner delegates writes to lib/db helpers, so a `.update(` never
// appears in the planner root even if it wrote a brief. This scan therefore names the brief WRITERS, the brief
// TABLE and the four brief-mutating RPCs, and pins the one legitimate reader import.
//
// BLIND SPOT, recorded: a brief write laundered through a NEW lib/db helper the scan does not list. The reader
// allowlist below closes that from the other side — the planner may import exactly one name from
// lib/db/campaign-briefs.

const BRIEF_WRITERS = [
  'createBrief',
  'submitBriefForCritique',
  'approveBrief',
  'reviseBrief',
  'markBriefGenerated',
  'setBriefPlanAnalysis',
  'approveBriefIfQualified',
  'critiqueBrief',
  'assembleBrief',
] as const
const BRIEF_WRITE_RPCS = [
  'apply_brief_proposals',
  'decide_plan_proposal',
  'approve_brief_and_supersede_proposals',
  'revise_brief_and_supersede_proposals',
] as const
const PLANNER_BRIEF_READER_ALLOWLIST = ['getBriefByCampaign']

export function findBriefWritePath(source: string): string[] {
  const hits: string[] = []
  const code = stripCode(source)
  for (const name of BRIEF_WRITERS) if (new RegExp(`\\b${name}\\b`).test(code)) hits.push(name)
  const withStrings = stripComments(source)
  if (/['"`]campaign_briefs['"`]/.test(withStrings)) hits.push("'campaign_briefs'")
  for (const rpc of BRIEF_WRITE_RPCS) if (withStrings.includes(rpc)) hits.push(rpc)
  for (const m of withStrings.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"](?:@\/lib\/db|\.{1,2}\/(?:\.\.\/)*db)\/campaign-briefs['"]/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0]
      if (name && !PLANNER_BRIEF_READER_ALLOWLIST.includes(name)) hits.push(`imports ${name} from lib/db/campaign-briefs`)
    }
  }
  return hits
}

describe('AGENCY-PLANNER-PROPOSES-ONLY — Tier 3 half (ADR 0027 §5.10, constraint 25)', () => {
  it('the detector flags a brief writer, the brief table, a brief RPC and a non-reader import (planted)', () => {
    expect(findBriefWritePath('await approveBrief(client, id)')).toEqual(['approveBrief'])
    expect(findBriefWritePath('await setBriefPlanAnalysis(client, id, x)')).toEqual(['setBriefPlanAnalysis'])
    expect(findBriefWritePath("client.from('campaign_briefs')")).toEqual(["'campaign_briefs'"])
    expect(findBriefWritePath("client.rpc('apply_brief_proposals', {})")).toEqual(['apply_brief_proposals'])
    expect(findBriefWritePath("import { reviseBrief } from '@/lib/db/campaign-briefs'")).toEqual([
      'reviseBrief',
      'imports reviseBrief from lib/db/campaign-briefs',
    ])
  })

  it('the detector allows the one reader import, and ignores comments and near-miss names (planted negatives)', () => {
    expect(findBriefWritePath("import { getBriefByCampaign } from '@/lib/db/campaign-briefs'")).toEqual([])
    expect(findBriefWritePath('// approveBrief(client, id) and campaign_briefs')).toEqual([])
    expect(findBriefWritePath('const approveBriefLabel = 1')).toEqual([])
  })

  it('lib/campaigns/planner/** has no write path to campaign_briefs, and the scan saw the module set', () => {
    const { files, offenders } = scanRoot([PLANNER_ROOT], isProdTs, (src) => findBriefWritePath(src))
    // constants, tools, persist, orchestrator — a floor of four so an emptied or moved root cannot pass vacuously.
    expect(files.length, 'the planner root matched fewer than four files — the scan would pass vacuously').toBeGreaterThanOrEqual(4)
    expect(offenders).toEqual([])
  })

  it('setBriefPlanAnalysis is referenced in exactly its definition and the one recorder (the column has one writer)', () => {
    const files = [path.join(ROOT, 'lib'), path.join(ROOT, 'app')].flatMap((r) => collect(r, isProdTs))
    const users = files.filter((f) => /\bsetBriefPlanAnalysis\b/.test(stripCode(fs.readFileSync(f, 'utf8')))).map(toRel).sort()
    expect(users).toEqual(['lib/campaigns/plan-brief.ts', 'lib/db/campaign-briefs.ts'])
  })
})

// ═══ AGENCY-PLANNER-REQUEST-PATH-ONLY (9) — Tier 3 half (added K2.7) ═══════════
// ADR 0027 §2.7, founder ruling A-8. The planner is request-path only: its tools' tenant boundary is the CALLER'S
// authenticated client, a premise a worker holding service-role breaks (ADR 0021 §2.3's reasoning would apply
// verbatim). "No planner import under a service-role-acquiring module" is the property, stated as a scan; the
// Tier-2 half asserts promote.ts and seed.ts leave the column at 'not_run'.
//
// BLIND SPOT, recorded: a TRANSITIVE import (a service-role module importing a module that imports the planner)
// is not seen; the property is checked one hop, which is the shape every real worker in this repo has.

export function importsPlanner(source: string, fileRel: string): boolean {
  return moduleSpecifiers(source).some((spec) => {
    const r = resolveSpec(spec, fileRel)
    return r === 'lib/campaigns/planner' || r.startsWith('lib/campaigns/planner/') || r === 'lib/campaigns/plan-brief'
  })
}

describe('AGENCY-PLANNER-REQUEST-PATH-ONLY — Tier 3 half (ADR 0027 §2.7, constraint 9)', () => {
  it('the detector flags a planner import by relative path, alias and dynamic import (planted)', () => {
    expect(importsPlanner("import { runPlannerForCampaign } from '@/lib/campaigns/planner/orchestrator'", 'lib/x.ts')).toBe(true)
    expect(importsPlanner("import { planBrief } from '@/lib/campaigns/plan-brief'", 'lib/x.ts')).toBe(true)
    expect(importsPlanner("const m = await import('./planner/orchestrator')", 'lib/campaigns/x.ts')).toBe(true)
  })

  it('the detector ignores unrelated modules and comments (planted negatives)', () => {
    expect(importsPlanner("import { assembleBrief } from '@/lib/campaigns/brief'", 'lib/x.ts')).toBe(false)
    expect(importsPlanner("// import { planBrief } from '@/lib/campaigns/plan-brief'", 'lib/x.ts')).toBe(false)
  })

  it('no module that acquires the service-role client imports the planner, and both sets are non-empty', () => {
    const files = [path.join(ROOT, 'lib'), path.join(ROOT, 'app')]
      .flatMap((r) => collect(r, isProdTs))
      .filter((f) => !toRel(f).startsWith('lib/campaigns/planner/'))
    const serviceRole = files.filter((f) => findServiceRoleReach(fs.readFileSync(f, 'utf8'), toRel(f)).length > 0)
    const plannerImporters = files.filter((f) => importsPlanner(fs.readFileSync(f, 'utf8'), toRel(f)))
    expect(serviceRole.length, 'no service-role-acquiring module found — the scan would pass vacuously').toBeGreaterThanOrEqual(5)
    expect(plannerImporters.length, 'nothing imports the planner — the scan would pass vacuously').toBeGreaterThanOrEqual(1)
    const both = plannerImporters.filter((f) => serviceRole.includes(f)).map(toRel)
    expect(both).toEqual([])
  })

  it('the two worker-side assembleBrief callers do not import the planner', () => {
    for (const rel of ['lib/campaigns/promote.ts', 'lib/signals/seed.ts']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      expect(importsPlanner(src, rel), `${rel} imports the planner — a worker must render 'not_run'`).toBe(false)
    }
  })
})

// ═══ AGENCY-TOOLS-ONCE-PER-CAMPAIGN (8) — Tier 3 half (added K2.7) ═════════════
// ADR 0027 §7.2: tools are built once per campaign, BEFORE the fan-out. Per candidate, a 6-post campaign would
// carry 18 tool loops (~200 cents of lookups against ~60 of generation). The Tier-2 half counts constructions
// behaviourally; this half scans generate.ts (the fan-out) and the call sites.

export function findPlannerToolConstruction(source: string): number {
  return [...stripCode(source).matchAll(/\bbuildPlannerTools\s*\(/g)].length
}

// buildPlannerTools( inside a callback handed to a fan-out primitive, or inside a for/while body.
export function findToolsInFanOut(source: string): string[] {
  const code = stripCode(source)
  const hits: string[] = []
  if (/(?:\.map|\.forEach|Array\.from|Promise\.all|Promise\.allSettled)\s*\([^;]*?\bbuildPlannerTools\s*\(/.test(code)) hits.push('fan-out callback')
  if (/\b(?:for|while)\s*\([^)]*\)\s*\{[^}]*\bbuildPlannerTools\s*\(/.test(code)) hits.push('loop body')
  return hits
}

describe('AGENCY-TOOLS-ONCE-PER-CAMPAIGN — Tier 3 half (ADR 0027 §7.2, constraint 8)', () => {
  it('the detectors count constructions and flag a fan-out or loop placement (planted)', () => {
    expect(findPlannerToolConstruction('const t = buildPlannerTools(c, b, id)')).toBe(1)
    expect(findToolsInFanOut('await Promise.allSettled(Array.from({ length: 3 }, () => buildPlannerTools(c, b, id)))')).not.toEqual([])
    expect(findToolsInFanOut('for (const p of posts) { const t = buildPlannerTools(c, b, id) }')).toEqual(['loop body'])
  })

  it('the detectors ignore a top-level construction and comments (planted negatives)', () => {
    expect(findToolsInFanOut('const tools = buildPlannerTools(c, b, id)\nawait Promise.all(posts.map((p) => run(p, tools)))')).toEqual([])
    expect(findPlannerToolConstruction('// buildPlannerTools(c, b, id)')).toBe(0)
  })

  it('generate.ts (the candidate fan-out) neither builds planner tools nor runs the loop', () => {
    const src = stripCode(fs.readFileSync(path.join(ROOT, 'lib', 'campaigns', 'generate.ts'), 'utf8'))
    expect(src.length, 'generate.ts read as empty — the scan would pass vacuously').toBeGreaterThan(1000)
    expect(findPlannerToolConstruction(src)).toBe(0)
    expect(/\brunToolLoop\b/.test(src)).toBe(false)
    expect(src.includes('Promise.allSettled'), 'the fan-out this scan guards is no longer in generate.ts — re-point it').toBe(true)
  })

  it('buildPlannerTools is constructed at exactly one production site, outside any fan-out', () => {
    const files = [path.join(ROOT, 'lib'), path.join(ROOT, 'app')].flatMap((r) => collect(r, isProdTs)).filter((f) => toRel(f) !== 'lib/campaigns/planner/tools.ts')
    const sites = files.flatMap((f) => {
      const n = findPlannerToolConstruction(fs.readFileSync(f, 'utf8'))
      return n > 0 ? [{ file: toRel(f), n }] : []
    })
    expect(sites).toEqual([{ file: 'lib/campaigns/planner/orchestrator.ts', n: 1 }])
    const orch = fs.readFileSync(path.join(ROOT, 'lib', 'campaigns', 'planner', 'orchestrator.ts'), 'utf8')
    expect(findToolsInFanOut(orch)).toEqual([])
  })
})

// ═══ constants.ts — ADR 0027 §3.2 / §7.4 / §2.3 transcription ════════════════
// Not a numbered constraint: the literals the later steps import. Pinned so a drive-by edit is a red test with
// the ADR section in its name, not a silent behaviour change (the bound tests in K2.2 import these constants and
// never hard-code a literal).

describe('planner constants transcribe ADR 0027 §3.2, §7.4 and §2.3', () => {
  it('the seven bounds, the reservation and the closed six-tool inventory', () => {
    expect(AI_PLANNER_MAX_TOOL_CALLS).toBe(4)
    expect(AI_PLANNER_MAX_TURNS).toBe(6)
    expect(AI_PLANNER_MAX_CUMULATIVE_INPUT_TOKENS).toBe(50_000)
    expect(AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN).toBe(2_048)
    expect(AI_PLANNER_MAX_CUMULATIVE_OUTPUT_TOKENS).toBe(6_000)
    expect(AI_PLANNER_MAX_WALL_CLOCK_MS).toBe(30_000)
    expect(AI_PLANNER_RETRY_BUDGET).toBe(1)
    expect(PLANNER_RESERVATION_CENTS).toBe(24)
    expect([...PLANNER_TOOL_NAMES]).toEqual([
      'list_evidence',
      'list_brand_claims',
      'list_audience_notes',
      'list_recent_campaigns',
      'get_campaign_signal',
      'list_recent_posts',
    ])
  })
})
