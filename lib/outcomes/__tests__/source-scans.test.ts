import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0026 §12.3 / build-guide J2.2 — the Tier-3 "properties of absence", written
// BEFORE any lib/outcomes code they fence (the ADR 0023 G1b.2 precedent). Each is
// an executable scan with TWO halves, because a scan that has never failed proves
// nothing:
//   1. a pure DETECTOR, unit-tested here against a PLANTED violation (this half
//      runs in CI forever, so the scan cannot rot into a vacuous pass); and
//   2. the detector run over the REAL tree, asserting it scanned a non-empty set.
// Tests are excluded from the real-tree scans (they legitimately contain planted
// strings). Closes OUTCOME-NO-RETRO-TAGGING (6), OUTCOME-DETERMINISTIC-NO-LLM
// (28), OUTCOME-NO-EXTRA-WRITER (31) and the scan half of
// OUTCOME-NO-ZERO-METRICS-REINTRODUCED (16, which closes in J2.9).

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

// ═══ OUTCOME-DETERMINISTIC-NO-LLM (28) ═══════════════════════════════════════
// lib/outcomes/** and app/api/cron/extract-outcomes/** import NOTHING from the AI
// layer (ADR 0026 rule 8: "no model call in the loop"; hookType is requested
// inside the EXISTING generation call, never here).

function moduleSpecifiers(source: string): string[] {
  const specs: string[] = []
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) specs.push(m[1])
  return specs
}

export function findAiLayerImports(source: string, fileRel: string): string[] {
  const hits: string[] = []
  for (const spec of moduleSpecifiers(stripTsComments(source))) {
    let resolved = spec
    if (spec.startsWith('.')) resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fileRel), spec))
    else if (spec.startsWith('@/')) resolved = spec.slice(2)
    if (
      resolved === 'lib/ai' ||
      resolved.startsWith('lib/ai/') ||
      spec.startsWith('@anthropic-ai/') ||
      spec === 'anthropic' ||
      spec === '@anthropic-ai'
    ) {
      hits.push(spec)
    }
  }
  return hits
}

describe('OUTCOME-DETERMINISTIC-NO-LLM (ADR 0026 §12.3, constraint 28)', () => {
  it('the detector flags every import shape of the AI layer (planted violations)', () => {
    const rel = 'lib/outcomes/probe.ts'
    expect(findAiLayerImports("import Anthropic from '@anthropic-ai/sdk'", rel)).toEqual(['@anthropic-ai/sdk'])
    expect(findAiLayerImports("import { run } from '@/lib/ai/runner'", rel)).toEqual(['@/lib/ai/runner'])
    expect(findAiLayerImports("import { x } from '@/lib/ai'", rel)).toEqual(['@/lib/ai'])
    expect(findAiLayerImports("import { x } from '../ai/client'", rel)).toEqual(['../ai/client'])
    expect(findAiLayerImports("const m = await import('@/lib/ai/client')", rel)).toEqual(['@/lib/ai/client'])
    expect(findAiLayerImports("const m = require('@anthropic-ai/sdk')", rel)).toEqual(['@anthropic-ai/sdk'])
  })

  it('the detector does NOT flag legitimate imports or commented-out ones', () => {
    const rel = 'lib/outcomes/extract.ts'
    expect(findAiLayerImports("import { OUTCOME_CAP } from './constants'", rel)).toEqual([])
    expect(findAiLayerImports("import { x } from '@/lib/db/post-outcomes'", rel)).toEqual([])
    expect(findAiLayerImports("import { x } from '@/lib/airtable-not-ai'", rel)).toEqual([])
    expect(findAiLayerImports("// import Anthropic from '@anthropic-ai/sdk'", rel)).toEqual([])
  })

  it('lib/outcomes/** and app/api/cron/extract-outcomes/** import nothing from lib/ai or @anthropic-ai', () => {
    const files = [
      ...collect(path.join(ROOT, 'lib', 'outcomes'), isProdTs),
      ...collect(path.join(ROOT, 'app', 'api', 'cron', 'extract-outcomes'), isProdTs),
    ]
    expect(files.length, 'the scan target matched zero files — it would pass vacuously').toBeGreaterThanOrEqual(1)

    const offenders: string[] = []
    for (const file of files) {
      const hits = findAiLayerImports(fs.readFileSync(file, 'utf8'), toRel(file))
      if (hits.length > 0) offenders.push(`${toRel(file)} -> ${hits.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})

// ═══ OUTCOME-NO-RETRO-TAGGING (6) ════════════════════════════════════════════
// post_dimensions is written ONLY by the AFTER INSERT trigger on post_ai_originals
// and by ONE history-copy migration (ADR 0026 §4.2/§4.5, L-4). No TS write, no
// classifier, no model call. Imports are never tagged.

// Any use of the post_dimensions table in TS other than a plain read is a
// finding: `.from('post_dimensions')` must be IMMEDIATELY followed by `.select(`
// (this also catches `const t = client.from('post_dimensions'); t.insert(...)`).
export function findPostDimensionsTsWrites(source: string): string[] {
  const clean = stripTsComments(source)
  const hits: string[] = []
  const fromNotSelect = /\.from\(\s*['"]post_dimensions['"]\s*\)(?!\s*\.select\s*\()/g
  if (fromNotSelect.test(clean)) hits.push("from('post_dimensions') not followed by .select(")
  if (/\.rpc\(\s*['"][^'"]*post_dimensions[^'"]*['"]/.test(clean)) hits.push('rpc naming post_dimensions')
  if (/insert\s+into\s+(?:public\.)?post_dimensions\b/i.test(clean)) hits.push('raw INSERT INTO post_dimensions')
  if (/update\s+(?:public\.)?post_dimensions\s+set\b/i.test(clean)) hits.push('raw UPDATE post_dimensions')
  return hits
}

// The migrations allowed to INSERT INTO public.post_dimensions. EMPTY today.
// J2.3 adds exactly TWO names — the trigger migration and the history-copy
// migration — and nothing else ever may (ADR 0026 §4.2, §4.5).
export const POST_DIMENSIONS_WRITER_MIGRATIONS: readonly string[] = []

export function migrationWritesPostDimensions(sql: string): boolean {
  return /insert\s+into\s+(?:public\.)?post_dimensions\b/i.test(stripSqlComments(sql))
}

describe('OUTCOME-NO-RETRO-TAGGING (ADR 0026 §12.3, constraint 6)', () => {
  it('the TS detector flags every write shape (planted violations)', () => {
    expect(findPostDimensionsTsWrites("await client.from('post_dimensions').insert({ role: 'x' })")).not.toEqual([])
    expect(findPostDimensionsTsWrites("await client.from('post_dimensions')\n  .upsert(rows)")).not.toEqual([])
    expect(findPostDimensionsTsWrites("await client.from('post_dimensions').update({ role: 'x' }).eq('a', 1)")).not.toEqual([])
    expect(findPostDimensionsTsWrites("const t = client.from('post_dimensions'); await t.insert(x)")).not.toEqual([])
    expect(findPostDimensionsTsWrites("await client.rpc('write_post_dimensions', {})")).not.toEqual([])
    expect(findPostDimensionsTsWrites("await pg.query('INSERT INTO public.post_dimensions (a) VALUES (1)')")).not.toEqual([])
  })

  it('the TS detector allows a plain read and ignores comments', () => {
    expect(findPostDimensionsTsWrites("await client.from('post_dimensions').select('role').eq('post_id', id)")).toEqual([])
    expect(findPostDimensionsTsWrites("// client.from('post_dimensions').insert(x)")).toEqual([])
  })

  it('the migration detector flags an INSERT INTO public.post_dimensions and ignores comments', () => {
    expect(migrationWritesPostDimensions('INSERT INTO public.post_dimensions (ai_original_id) SELECT 1;')).toBe(true)
    expect(migrationWritesPostDimensions('insert into post_dimensions (a) values (1);')).toBe(true)
    expect(migrationWritesPostDimensions('-- INSERT INTO public.post_dimensions is written by the trigger\nSELECT 1;')).toBe(false)
  })

  it('no production TS (lib/, app/, components/, scripts/) writes post_dimensions', () => {
    const files = ['lib', 'app', 'components', 'scripts'].flatMap((d) => collect(path.join(ROOT, d), isProdTs))
    expect(files.length, 'scanned suspiciously few files').toBeGreaterThan(200)

    const offenders: string[] = []
    for (const file of files) {
      const hits = findPostDimensionsTsWrites(fs.readFileSync(file, 'utf8'))
      if (hits.length > 0) offenders.push(`${toRel(file)}: ${hits.join('; ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('an INSERT INTO public.post_dimensions appears in migrations ONLY in the allowlist (empty until J2.3)', () => {
    const migrations = collect(path.join(ROOT, 'supabase', 'migrations'), (n) => n.endsWith('.sql'))
    expect(migrations.length, 'scanned suspiciously few migrations').toBeGreaterThan(50)

    const writers = migrations
      .filter((f) => migrationWritesPostDimensions(fs.readFileSync(f, 'utf8')))
      .map((f) => path.basename(f))
    const unexpected = writers.filter((name) => !POST_DIMENSIONS_WRITER_MIGRATIONS.includes(name))
    expect(unexpected).toEqual([])
  })
})

// ═══ OUTCOME-NO-EXTRA-WRITER (31) ════════════════════════════════════════════
// The literal `source` values written by any migration's INSERT INTO
// public.performance_memory (function bodies included) are exactly the allowlist.
// The authenticated 'manual' path is RLS, not a migration insert, so it never
// appears here. J2.5/J2.6 add 'outcome' to the allowlist — and nothing else may.

export const PERFORMANCE_MEMORY_WRITER_SOURCES: readonly string[] = ['distilled', 'import']

// Skips a single-quoted SQL string starting at `i` (handles '' escapes); returns
// the index just past its closing quote.
function skipString(text: string, i: number): number {
  let j = i + 1
  while (j < text.length) {
    if (text[j] === "'") {
      if (text[j + 1] === "'") j += 2
      else return j + 1
    } else j += 1
  }
  return j
}

// Index of the ')' matching the '(' at `open`, respecting quotes.
function matchingParen(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "'") {
      i = skipString(text, i) - 1
    } else if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function splitTopLevel(text: string): string[] {
  const items: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "'") i = skipString(text, i) - 1
    else if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      items.push(text.slice(start, i))
      start = i + 1
    }
  }
  items.push(text.slice(start))
  return items.map((s) => s.trim())
}

// The select-list of `INSERT ... SELECT a, b, c FROM/WHERE/ON CONFLICT ...`.
function selectListEnd(text: string, from: number): number {
  let depth = 0
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "'") i = skipString(text, i) - 1
    else if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (depth === 0 && /^(?:from|where|on\s+conflict|returning|group\s+by|order\s+by|limit)\b/i.test(text.slice(i, i + 16))) return i
    else if (depth === 0 && ch === ';') return i
  }
  return text.length
}

export interface WriterSources {
  literals: string[]
  // A `source` that is NOT a quoted literal (a parameter, a subquery, a column
  // missing from the list): an unauditable writer, always a finding.
  nonLiteral: number
}

export function extractPerformanceMemoryWriterSources(sql: string): WriterSources {
  const clean = stripSqlComments(sql)
  const out: WriterSources = { literals: [], nonLiteral: 0 }
  const re = /insert\s+into\s+(?:public\.)?performance_memory\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(clean)) !== null) {
    const open = m.index + m[0].length - 1
    const close = matchingParen(clean, open)
    if (close === -1) {
      out.nonLiteral += 1
      continue
    }
    const columns = splitTopLevel(clean.slice(open + 1, close)).map((c) => c.toLowerCase())
    const sourceIdx = columns.indexOf('source')
    const rest = clean.slice(close + 1)
    const kind = /^\s*(values|select)\b/i.exec(rest)
    if (sourceIdx === -1 || !kind) {
      out.nonLiteral += 1
      continue
    }
    const kindStart = close + 1 + kind[0].length
    let items: string[]
    if (kind[1].toLowerCase() === 'values') {
      const tupleOpen = clean.indexOf('(', kindStart)
      const tupleClose = tupleOpen === -1 ? -1 : matchingParen(clean, tupleOpen)
      items = tupleClose === -1 ? [] : splitTopLevel(clean.slice(tupleOpen + 1, tupleClose))
    } else {
      items = splitTopLevel(clean.slice(kindStart, selectListEnd(clean, kindStart)))
    }
    const item = items[sourceIdx]
    const literal = item === undefined ? null : /^'([^']*)'$/.exec(item)
    if (literal) out.literals.push(literal[1])
    else out.nonLiteral += 1
  }
  return out
}

describe('OUTCOME-NO-EXTRA-WRITER (ADR 0026 §12.3, constraint 31)', () => {
  it('the extractor reads the literal source of a VALUES insert and of an INSERT ... SELECT', () => {
    const values = `INSERT INTO public.performance_memory (business_id, source, dimension)
      VALUES (p_business_id, 'distilled', coalesce(p_dim, 'topic')) ON CONFLICT DO NOTHING;`
    const select = `INSERT INTO public.performance_memory (business_id, source, dimension)
      SELECT p_business_id, 'import', p_dim WHERE (SELECT count(*) FROM public.x WHERE a = 'b') < 15;`
    expect(extractPerformanceMemoryWriterSources(values)).toEqual({ literals: ['distilled'], nonLiteral: 0 })
    expect(extractPerformanceMemoryWriterSources(select)).toEqual({ literals: ['import'], nonLiteral: 0 })
  })

  it('a planted migration writing an unlisted source (manual2) is caught, and so is a non-literal source', () => {
    const planted = "INSERT INTO public.performance_memory (business_id, source) VALUES (p_business_id, 'manual2');"
    const found = extractPerformanceMemoryWriterSources(planted)
    expect(found.literals).toEqual(['manual2'])
    expect(found.literals.filter((s) => !PERFORMANCE_MEMORY_WRITER_SOURCES.includes(s))).toEqual(['manual2'])

    const param = 'INSERT INTO public.performance_memory (business_id, source) VALUES (p_business_id, p_source);'
    expect(extractPerformanceMemoryWriterSources(param).nonLiteral).toBe(1)
    const noSource = 'INSERT INTO public.performance_memory (business_id, pattern) VALUES (p_business_id, $1);'
    expect(extractPerformanceMemoryWriterSources(noSource).nonLiteral).toBe(1)
  })

  it('commented-out inserts are ignored', () => {
    const commented = "-- INSERT INTO public.performance_memory (source) VALUES ('manual2');\nSELECT 1;"
    expect(extractPerformanceMemoryWriterSources(commented)).toEqual({ literals: [], nonLiteral: 0 })
  })

  it('the source values written by ALL migrations are exactly the allowlist, with no unauditable writer', () => {
    const migrations = collect(path.join(ROOT, 'supabase', 'migrations'), (n) => n.endsWith('.sql'))
    expect(migrations.length, 'scanned suspiciously few migrations').toBeGreaterThan(50)

    const written = new Set<string>()
    let nonLiteral = 0
    let inserts = 0
    for (const file of migrations) {
      const sql = fs.readFileSync(file, 'utf8')
      inserts += (stripSqlComments(sql).match(/insert\s+into\s+(?:public\.)?performance_memory\s*\(/gi) ?? []).length
      const found = extractPerformanceMemoryWriterSources(sql)
      found.literals.forEach((s) => written.add(s))
      nonLiteral += found.nonLiteral
    }
    expect(inserts, 'no performance_memory INSERT was found — the extractor would pass vacuously').toBeGreaterThanOrEqual(4)
    expect(nonLiteral).toBe(0)
    expect([...written].sort()).toEqual([...PERFORMANCE_MEMORY_WRITER_SOURCES].sort())
  })
})

// ═══ OUTCOME-NO-ZERO-METRICS-REINTRODUCED (16) — scan half ═══════════════════
// MINOR-2 (lib/memory/performance.ts): a governed row is a distilled insight, not
// a post, so its rendered object carries NO likes / impressions key — a literal
// "0 likes, 0 impressions" would read to the model as evidence the pattern
// performs badly. This scan pins that; the render-test half closes in J2.9.

export function governedMapBody(source: string): string | null {
  const clean = stripTsComments(source)
  const m = /ranked\.map\(\s*record\s*=>\s*\(\{([\s\S]*?)\}\)\s*\)/.exec(clean)
  return m ? m[1] : null
}

export function findGovernedMetricKeys(source: string): string[] {
  const body = governedMapBody(source)
  if (body === null) return ['governed .map(record => ({...})) block not found']
  const hits: string[] = []
  if (/\blikes\b/.test(body)) hits.push('likes')
  if (/\bimpressions\b/.test(body)) hits.push('impressions')
  if (!/provenance:\s*'governed'/.test(body)) hits.push("provenance: 'governed' missing")
  return hits
}

describe('OUTCOME-NO-ZERO-METRICS-REINTRODUCED — scan half (ADR 0026 §12.3, constraint 16)', () => {
  const planted = `return ranked.map(record => ({
      platform: record.platform,
      topContent: record.pattern,
      likes: 0,
      provenance: 'governed' as const,
    }))`

  it('the detector flags a likes: 0 or impressions: 0 in the governed render (planted)', () => {
    expect(findGovernedMetricKeys(planted)).toEqual(['likes'])
    expect(findGovernedMetricKeys(planted.replace('likes: 0', 'impressions: 0'))).toEqual(['impressions'])
  })

  it('the detector reports a missing block instead of passing vacuously', () => {
    expect(findGovernedMetricKeys('export const x = 1')).toEqual(['governed .map(record => ({...})) block not found'])
  })

  it("lib/memory/performance.ts's governed row carries no likes or impressions key, and both stay OPTIONAL on the type", () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib', 'memory', 'performance.ts'), 'utf8')
    expect(findGovernedMetricKeys(source)).toEqual([])
    const clean = stripTsComments(source)
    expect(clean).toMatch(/likes\?:\s*number/)
    expect(clean).toMatch(/impressions\?:\s*number/)
  })
})
