import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0027 §6.5 / §8 (Session 34 K2.10) — AGENCY-NO-UNSAFE-HTML (40), Tier 3.
// The planner's reason and every claim field render as PLAIN TEXT, never
// markdown or HTML (closes ADR 0020 §7.1's markdown-image exfiltration vector
// by construction). Scoped to this session's two surfaces; each root is
// vacuity-guarded (ADR 0015 §1(c)) so a renamed directory fails loudly.

function stripLineComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

const ROOT = process.cwd()
const DASHBOARD = path.join(ROOT, 'app', '[locale]', '(dashboard)')
const SCAN_ROOTS = [
  path.join(DASHBOARD, 'approvals'),
  path.join(DASHBOARD, 'campaigns', '[id]', 'brief'),
]

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('AGENCY-NO-UNSAFE-HTML — no dangerouslySetInnerHTML on the approvals or brief-review surface', () => {
  it('no source file under either surface uses dangerouslySetInnerHTML', () => {
    for (const root of SCAN_ROOTS) {
      expect(collectSourceFiles(root).length, `${root} contributed zero files to the scan`).toBeGreaterThan(0)
    }

    const offenders: string[] = []
    for (const file of SCAN_ROOTS.flatMap(collectSourceFiles)) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (/dangerouslySetInnerHTML/.test(source)) offenders.push(path.relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})
