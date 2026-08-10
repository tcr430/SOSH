import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0021 §2.2/§7.3 (Session 28 E5.5) — SIGNAL3-TOOLS-READ-ONLY and the
// no-JSON.stringify half of SIGNAL3-TOOL-RESULTS-GUARDED, made executable.
// Both per-root vacuity guarded (ADR 0015 §1(c)): an accidentally-empty or
// renamed lib/signals/triage/ must fail loudly, not pass vacuously.

function stripLineComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

const ROOT = process.cwd()
const TRIAGE_DIR = path.join(ROOT, 'lib', 'signals', 'triage')

function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__fixtures__' || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full))
    } else if (/\.ts$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('SIGNAL3-TOOLS-READ-ONLY (ADR 0021 §2.2)', () => {
  const WRITE_VERB_PATTERN = /\.(insert|update|upsert|delete|rpc)\s*\(/

  it('no file under lib/signals/triage/ calls a write verb on a Supabase client', () => {
    const files = collectTsFiles(TRIAGE_DIR)
    expect(files.length, `${TRIAGE_DIR} contributed zero files to the scan`).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (WRITE_VERB_PATTERN.test(source)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})

describe('SIGNAL3-TOOL-RESULTS-GUARDED — no-JSON.stringify half (ADR 0021 §7.3)', () => {
  // Scoped to tools.ts specifically, not the whole lib/signals/triage/ tree
  // — the property is "the tool module never stringifies its own tool
  // result" (that call site is lib/ai/tool-runner.ts alone). The
  // orchestrator (E5.6) legitimately calls JSON.stringify once, for the
  // canonical tick log line (lib/learning/orchestrator.ts's own pattern) —
  // an unrelated concern this scan must not flag.
  const TOOLS_FILE = path.join(TRIAGE_DIR, 'tools.ts')

  it('lib/signals/triage/tools.ts calls JSON.stringify itself — that call site is lib/ai/tool-runner.ts alone', () => {
    expect(fs.existsSync(TOOLS_FILE), `${TOOLS_FILE} no longer exists — update this scan`).toBe(true)
    const source = stripLineComments(fs.readFileSync(TOOLS_FILE, 'utf8'))
    expect(/JSON\.stringify/.test(source)).toBe(false)
  })
})

// Session 28-D, D3 (MAJOR-5 closed) — ADR §7.3's rule, as written, is about
// THE DISPATCHER (lib/ai/tool-runner.ts:346's `content: JSON.stringify(toolResult)`),
// not about tools.ts — but the scan above never read that file, so it was
// structurally incapable of failing for the file the rule actually names.
// Disposition (a), per the Reviewer's own preference: extend the scan to
// lib/ai/tool-runner.ts and amend the ADR to state the guarantee the code
// actually implements, rather than re-architecting a working boundary.
// AMENDMENT (ADR 0021 §7.3): the guarantee is "guarded at the tool
// boundary, serialised by the dispatcher" — every string field a tool
// returns is wrapped (wrapToolResultForPrompt/wrapEvidenceForPrompt)
// BEFORE it leaves tools.ts (proven by tools.test.ts's fixture-based
// neutralisation cases — a semantic property no source scan can prove); the
// dispatcher's job is only to serialise an ALREADY-GUARDED value via
// JSON.stringify, and it must do so through exactly ONE call site, never a
// raw template/concatenation that would bypass JSON's escaping.
describe('SIGNAL3-TOOL-RESULTS-GUARDED — the dispatcher\'s serialisation boundary (ADR 0021 §7.3, amended)', () => {
  const TOOL_RUNNER_FILE = path.join(ROOT, 'lib', 'ai', 'tool-runner.ts')

  it("lib/ai/tool-runner.ts serialises a tool result via JSON.stringify(toolResult) exactly once — the ONE sanctioned call site the ADR names, never a raw template or concatenation that would bypass it", () => {
    expect(fs.existsSync(TOOL_RUNNER_FILE), `${TOOL_RUNNER_FILE} no longer exists — update this scan`).toBe(true)
    const source = stripLineComments(fs.readFileSync(TOOL_RUNNER_FILE, 'utf8'))

    const stringifyCallSites = source.match(/JSON\.stringify\(toolResult\)/g) ?? []
    expect(stringifyCallSites).toHaveLength(1)

    // A raw template interpolation or string concatenation of toolResult
    // would bypass JSON.stringify's escaping and reopen the guard gap this
    // scan exists to catch — even though every field tools.ts returns is
    // already wrapped, an unescaped embed could still let sentinel/control
    // characters through unescaped into the prompt.
    expect(/\$\{[^}]*toolResult/.test(source)).toBe(false)
    expect(/toolResult\s*\+/.test(source)).toBe(false)
    expect(/\+\s*toolResult/.test(source)).toBe(false)
  })
})
