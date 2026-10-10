import { promises as fs } from 'node:fs'
import path from 'node:path'
import { compile } from 'tailwindcss'

// ADR 0031 §5.5, §10.5 — the PDF's stylesheet: the SAME Tailwind utilities and design tokens the report page uses, compiled
// at request time for ONLY the classes the rendered body contains, and inlined into the document (Chromium is never allowed to
// fetch a stylesheet). It uses `tailwindcss`' own compiler (a declared dependency): no PostCSS, no lightningcss, no new package.
//
// What is read: tailwindcss' four stylesheets (theme, preflight, utilities) and the `@theme inline` and `:root` blocks of
// app/globals.css, so a token changed for the page changes the PDF. Nothing customer-supplied reaches the compiler except as
// a candidate class NAME drawn from our own markup, and the output is checked to be inert inside a <style> element.
// UNPROVEN on Vercel until a preview deploy: the files read here must be traced into the function (next.config.ts).

const ROOT = process.cwd()
const TAILWIND_DIR = path.join(ROOT, 'node_modules', 'tailwindcss')
const GLOBALS = path.join(ROOT, 'app', 'globals.css')

/** The page's font stack variable is a next/font variable that does not exist here; the PDF uses the system stack. */
const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Open Sans", "Helvetica Neue", Arial, sans-serif'

/** The block that starts at `header` in `css`, braces balanced: "@theme inline { … }". Empty when absent. */
export function extractBlock(css: string, header: string): string {
  const start = css.indexOf(header)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, i + 1)
    }
  }
  return ''
}

/** Every class token in the markup's `class="…"` attributes (escaped customer text cannot form one: its quotes are &quot;). */
export function extractClasses(html: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/\bclass="([^"]*)"/g)) {
    // React escapes "&" in an attribute as "&amp;", and a browser decodes it back. Tailwind must see the DECODED class, or every
    // arbitrary variant ([&_section]:border-t, print:[&_tr]:break-inside-avoid) is a candidate that matches nothing and its rule
    // silently vanishes from the PDF. Only &amp; is decoded: a class never carries another entity, and any other one is dropped
    // by the markup-character filter below.
    for (const token of m[1].replace(/&amp;/g, '&').split(/\s+/)) if (token && !/[<>"'`\\]/.test(token)) out.add(token)
  }
  return [...out]
}

/** The stylesheet INPUT (file reads and block extraction), cached per instance. A failed read is not cached. */
let inputCss: Promise<string> | null = null

async function loadInput(): Promise<string> {
  const globals = await fs.readFile(GLOBALS, 'utf8')
  return [
    '@layer theme, base, components, utilities;',
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/preflight.css" layer(base);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
    extractBlock(globals, '@theme inline'),
    extractBlock(globals, ':root'),
    `:root { --font-geist-sans: ${FONT_STACK}; --font-geist-mono: ui-monospace, monospace; }`,
    'body { background: #fff; color: var(--foreground); font-family: var(--font-geist-sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    '@page { size: A4; margin: 16mm; }',
  ].join('\n')
}

// The COMPILER is built fresh for every request on purpose: `build()` is incremental and remembers every candidate it has
// ever been given, so a shared compiler would carry one request's classes into the next (and one refused candidate would
// poison every later render). Compiling the small input again costs milliseconds.
async function newCompiler(input: string) {
  return compile(input, {
    base: ROOT,
    // Only tailwindcss' own stylesheets resolve. Any other import (a plugin, a URL, a path) is refused, never read.
    loadStylesheet: async (id: string, base: string) => {
      const match = /^tailwindcss\/(theme|preflight|utilities)\.css$/.exec(id)
      if (!match) throw new Error('report css: refusing to load ' + id)
      const file = path.join(TAILWIND_DIR, match[1] + '.css')
      return { path: file, base, content: await fs.readFile(file, 'utf8') }
    },
    loadModule: async (id: string) => {
      throw new Error('report css: refusing to load module ' + id)
    },
  })
}

/** The stylesheet for exactly these classes, and no others. */
export async function compileReportCss(classes: readonly string[]): Promise<string> {
  inputCss ??= loadInput().catch((error) => {
    inputCss = null
    throw error
  })
  const css = (await newCompiler(await inputCss)).build([...classes])
  // Inert inside <style>: a closing tag in the output would end the element and let the rest be parsed as markup.
  if (/<\/|<!--/.test(css)) throw new Error('report css: output is not safe to inline')
  return css
}
