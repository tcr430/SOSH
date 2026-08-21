import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0021 §2.1 (Session 28 E5.4) — SIGNAL3-AI-LAYER-ROUTED. `lib/ai/tool-runner.ts`
// is the ONLY module allowed to import @anthropic-ai/sdk for the triage loop;
// `lib/signals/**` (including the not-yet-built lib/signals/triage/, E5.5+)
// must call into it rather than construct its own SDK client — the exact
// violation security-reviewer caught in ADR 0021's draft (§2.1: "My draft put
// that machinery in lib/signals/triage/, calling @anthropic-ai/sdk directly").
//
// Deliberately narrower than the pre-existing SIGNAL-NO-LLM-IN-STAGE-AB scan
// (source-scans.test.ts), which also forbids importing `@/lib/ai/*` at all —
// that Session 27 rule predates ADR 0021 and would block Stage C's future,
// sanctioned `import { runToolLoop } from '@/lib/ai/tool-runner'`. This scan
// tests the ADR 0021 property specifically: no direct SDK import, ever.

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

// Strips `//` line comments before matching, so prose mentioning the forbidden
// import inside a comment (like this file's own header, or a future one
// explaining why the rule exists) is never mistaken for the import itself.
function stripLineComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

const ROOT = process.cwd()
const LIB_SIGNALS_DIR = path.join(ROOT, 'lib', 'signals')

describe('SIGNAL3-AI-LAYER-ROUTED (ADR 0021 §2.1)', () => {
  it('no file under lib/signals/** imports @anthropic-ai/sdk directly', () => {
    const files = collectTsFiles(LIB_SIGNALS_DIR)
    // Per-root vacuity guard (ADR 0015 §1(c)): an accidentally-empty or
    // renamed lib/signals/ must fail loudly, not pass vacuously.
    expect(files.length, `${LIB_SIGNALS_DIR} contributed zero files to the scan`).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/from\s+['"]@anthropic-ai\/sdk['"]/.test(source)) {
        offenders.push(path.relative(ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('lib/ai/tool-runner.ts itself still imports @anthropic-ai/sdk (guards against the allowlist going stale)', () => {
    const toolRunnerPath = path.join(ROOT, 'lib', 'ai', 'tool-runner.ts')
    expect(fs.existsSync(toolRunnerPath), 'lib/ai/tool-runner.ts no longer exists — update this scan').toBe(true)
    const source = fs.readFileSync(toolRunnerPath, 'utf8')
    expect(/from\s+['"]@anthropic-ai\/sdk['"]/.test(source)).toBe(true)
  })
})
