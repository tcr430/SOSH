declare module '*.mdx' {
  import type { ComponentType } from 'react'

  /** Frontmatter schema for content/legal/*.mdx (ADR 0009 §7). */
  export const frontmatter: {
    title: string
    /** ISO date once real copy lands; "TBD" at launch. */
    lastUpdated: string
    locale: string
  }

  const MDXContent: ComponentType<{ components?: Record<string, ComponentType> }>
  export default MDXContent
}
