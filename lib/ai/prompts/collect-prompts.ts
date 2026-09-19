import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Prompt } from './types'
import { createNativeGenerationPrompt, NATIVE_GENERATION_FAMILIES } from './formats/native-generation-prompt'

// ADR 0024 §15 (Session 31-D, D1/MAJOR-2) — the SINGLE enumeration of every
// live prompt in lib/ai/prompts/, consumed by BOTH
// prompt-properties.frozen-table.test.ts (QUAL-SAMPLING-VERSIONED) and
// lib/scope-scans.test.ts (QUAL-NO-NEW-AI-SURFACE). Before this file
// existed, each test hand-maintained its OWN ten-item import list — a
// prompt added to disk without a matching edit to BOTH lists shipped green
// on both constraints. A single collector removes the second copy that made
// that possible.
//
// This WALKS THE FILESYSTEM rather than iterating a hand-written array, so
// an eleventh prompt file needs no import-list edit anywhere to be found —
// only a missing frozen-table row (prompt-properties.frozen-table.test.ts)
// or a missing bijection partner (scope-scans.test.ts) will fail it.

const PROMPTS_ROOT = path.dirname(fileURLToPath(import.meta.url))
const EXCLUDE_DIR_NAMES = new Set(['__fixtures__'])
const SELF_PATH = fileURLToPath(import.meta.url)

function isPromptLike(value: unknown): value is Prompt<unknown, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.version === 'number' &&
    typeof candidate.modelKey === 'string' &&
    typeof candidate.outputSchema === 'object' &&
    candidate.outputSchema !== null &&
    typeof candidate.buildSystemPrompt === 'function' &&
    typeof candidate.buildUserMessage === 'function'
  )
}

function walkPromptFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkPromptFiles(full))
      continue
    }
    if (!entry.name.endsWith('.ts')) continue
    if (entry.name.endsWith('.test.ts')) continue
    // This file itself: no Prompt-shaped export, harmless to include, but
    // excluded explicitly so the walk never re-enters its own module.
    if (full === SELF_PATH) continue
    out.push(full)
  }
  return out
}

/**
 * Every live Prompt object under lib/ai/prompts/, found by walking the
 * filesystem and importing each module — never by a hand-written list of
 * ids or filenames.
 *
 * The one hand-written piece that remains: the native-generation FACTORY
 * (lib/ai/prompts/formats/native-generation-prompt.ts) exports a FUNCTION,
 * not a Prompt object, so no structural walk can discover its three
 * families on its own. Its families are driven off ITS OWN runtime
 * enumeration (NATIVE_GENERATION_FAMILIES, exported alongside the factory)
 * rather than a literal duplicated here — a fourth family added to that one
 * array is picked up with no edit to this file.
 */
export async function collectPrompts(): Promise<Array<Prompt<unknown, unknown>>> {
  const prompts: Array<Prompt<unknown, unknown>> = []

  for (const file of walkPromptFiles(PROMPTS_ROOT)) {
    const mod: Record<string, unknown> = await import(pathToFileURL(file).href)
    for (const exported of Object.values(mod)) {
      if (isPromptLike(exported)) prompts.push(exported)
    }
  }

  // createNativeGenerationPrompt is intentionally overloaded on LITERAL
  // family strings only (ADR 0017 §4.4 [type-1], so a caller with a known
  // literal gets a concretely typed Prompt back). Iterating a `FormatFamily`
  // ARRAY has no matching overload — this cast targets the factory's own
  // implementation signature (family: FormatFamily) => Prompt<...>|...|...,
  // never `any`, and only at this one dynamic call site.
  const createForFamily = createNativeGenerationPrompt as (
    family: (typeof NATIVE_GENERATION_FAMILIES)[number],
  ) => Prompt<unknown, unknown>
  for (const family of NATIVE_GENERATION_FAMILIES) {
    prompts.push(createForFamily(family))
  }

  return prompts
}
