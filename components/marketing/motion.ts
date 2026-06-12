/**
 * Canonical motion values for the marketing surface (ADR 0009 §8).
 * One of each — no per-component drift.
 */
export const SECTION_MOTION = {
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-10% 0px' },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
} as const

export const STAGGER_CHILD = {
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
} as const
// parent uses transition={{ staggerChildren: 0.08 }}
