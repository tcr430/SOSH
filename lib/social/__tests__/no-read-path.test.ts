import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// SOCIAL-NO-READ-PATH (ADR 0028 build-guide N2.13, §12). This session (N)
// builds OAuth, publish, refresh, revoke and metrics — never a content READ
// path. fetchRecentPosts / listRecentPosts is Session 32's own deliverable,
// designed against LinkedInProvider/TwitterProvider (not a broker) and
// landing as ADR 0002 Amendment B. Adding either member here now would be
// scope creep this ADR explicitly does not claim ("This ADR does not design
// the read path", §12). Scanned as source text, not a type check, so the
// same rule also catches a same-named helper function or route added
// elsewhere in lib/social/ that isn't on the interface itself.
const SOCIAL_DIR = path.join(process.cwd(), 'lib', 'social')

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__integration__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectTsFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('SOCIAL-NO-READ-PATH', () => {
  it('no production file under lib/social/ (excluding __integration__) defines fetchRecentPosts or listRecentPosts', () => {
    const files = collectTsFiles(SOCIAL_DIR)
    expect(files.length, 'lib/social/ contributed zero files to the scan').toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      if (/fetchRecentPosts|listRecentPosts/.test(content)) {
        offenders.push(path.relative(process.cwd(), file).replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })
})
