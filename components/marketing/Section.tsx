'use client'

import { motion } from 'motion/react'
import { SECTION_MOTION, STAGGER_CHILD } from '@/components/marketing/motion'

/**
 * Canonical section entrance wrapper (ADR 0009 §8). The ONLY place section
 * entrance motion lives. Section bodies stay RSC — passed in as children.
 */
export function Section({
  id,
  className,
  children,
}: {
  id?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.section id={id} className={className} {...SECTION_MOTION}>
      {children}
    </motion.section>
  )
}

/**
 * Staggered child entrance (ADR 0009 §8: 0.08s between grouped children).
 * STAGGER_CHILD uses whileInView props rather than variants, so the 0.08s
 * sequencing is applied as a per-child delay of index * 0.08 — same duration,
 * ease, and transform as the canonical constants.
 */
export function StaggerItem({
  index,
  className,
  children,
}: {
  index: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      className={className}
      {...STAGGER_CHILD}
      transition={{ ...STAGGER_CHILD.transition, delay: index * 0.08 }}
    >
      {children}
    </motion.div>
  )
}
