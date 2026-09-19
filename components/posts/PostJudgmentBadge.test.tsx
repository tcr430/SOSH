// Session 31-D, D12 (MINOR-6). PostJudgmentBadge.tsx's two status states
// (all-below-threshold, judged-and-passed) previously rendered raw Tailwind
// palette classes (amber-100/800, emerald-100/800, plus dark: variants) with
// no token and no contrast test — MINOR-6 in docs/reviews/session-31-reviewer.md.
// Fixed by switching to --warning/--success (the SAME tokens
// OpportunityFeed.tsx and StudioEditor.tsx already use, Session 28-D D5,
// pre-verified >=5.69:1 AA). This file proves THIS component's specific
// pairing meets the 4.5:1 AA floor in both themes, mirroring
// StudioEditor.test.tsx's own reasoning for re-testing a reused token pair:
// the pairing is this component's own constraint, not inherited automatically
// from another file's proof.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function relativeLuminanceFromLinearRgb(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function hexToRelativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = srgbChannelToLinear(((n >> 16) & 255) / 255)
  const g = srgbChannelToLinear(((n >> 8) & 255) / 255)
  const b = srgbChannelToLinear((n & 255) / 255)
  return relativeLuminanceFromLinearRgb(r, g, b)
}
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const GLOBALS_CSS = readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8')

function cssBlock(selector: string): string {
  const start = GLOBALS_CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`globals.css: no "${selector} {" block found`)
  const end = GLOBALS_CSS.indexOf('}', start)
  if (end === -1) throw new Error(`globals.css: "${selector}" block is unterminated`)
  return GLOBALS_CSS.slice(start, end)
}

function hexTokenLuminance(selector: string, token: string): number {
  const block = cssBlock(selector)
  const m = block.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`globals.css: "${selector}" has no --${token}: #hex`)
  return hexToRelativeLuminance(m[1])
}

describe('PostJudgmentBadge — status badge contrast (Session 31-D, D12, MINOR-6, WCAG AA, both themes)', () => {
  it('warning-foreground on warning (all-below-threshold badge) meets the 4.5:1 AA floor in the light theme', () => {
    expect(contrastRatio(hexTokenLuminance(':root', 'warning-foreground'), hexTokenLuminance(':root', 'warning'))).toBeGreaterThanOrEqual(4.5)
  })

  it('warning-foreground on warning (all-below-threshold badge) meets the 4.5:1 AA floor in the dark theme', () => {
    expect(contrastRatio(hexTokenLuminance('.dark', 'warning-foreground'), hexTokenLuminance('.dark', 'warning'))).toBeGreaterThanOrEqual(4.5)
  })

  it('success-foreground on success (judged-and-passed badge) meets the 4.5:1 AA floor in the light theme', () => {
    expect(contrastRatio(hexTokenLuminance(':root', 'success-foreground'), hexTokenLuminance(':root', 'success'))).toBeGreaterThanOrEqual(4.5)
  })

  it('success-foreground on success (judged-and-passed badge) meets the 4.5:1 AA floor in the dark theme', () => {
    expect(contrastRatio(hexTokenLuminance('.dark', 'success-foreground'), hexTokenLuminance('.dark', 'success'))).toBeGreaterThanOrEqual(4.5)
  })
})
