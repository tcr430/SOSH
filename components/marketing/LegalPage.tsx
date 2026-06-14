import TermsContent, { frontmatter as termsFrontmatter } from '@/content/legal/terms.en.mdx'
import PrivacyContent, { frontmatter as privacyFrontmatter } from '@/content/legal/privacy.en.mdx'
import SubprocessorsContent, { frontmatter as subprocessorsFrontmatter } from '@/content/legal/subprocessors.en.mdx'

// TODO(legal-copy PR, ADR 0009 §7/§15): per-locale resolution (.pt.mdx /
// .es.mdx). At launch every locale serves the .en.mdx stub — the frontmatter
// `locale: "en"` marks the EN stub being served to all locales.
const LEGAL_CONTENT = {
  terms: { Content: TermsContent, frontmatter: termsFrontmatter },
  privacy: { Content: PrivacyContent, frontmatter: privacyFrontmatter },
  subprocessors: { Content: SubprocessorsContent, frontmatter: subprocessorsFrontmatter },
} as const

/** MDX wrapper for /terms, /privacy, and /subprocessors (ADR 0009 §7, ADR 0010 §15). */
export default function LegalPage({ slug }: { slug: 'terms' | 'privacy' | 'subprocessors' }) {
  const { Content, frontmatter } = LEGAL_CONTENT[slug]

  return (
    <article className="prose mx-auto max-w-2xl px-6 py-20">
      <h1>{frontmatter.title}</h1>
      <p className="text-muted-foreground">Last updated: {frontmatter.lastUpdated}</p>
      <Content />
    </article>
  )
}
