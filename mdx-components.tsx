import type { MDXComponents } from 'mdx/types'

// Required by @next/mdx in the App Router. Pass-through — legal pages style
// themselves via the `prose` wrapper in LegalPage (ADR 0009 §7).
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components }
}
