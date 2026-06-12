'use client'

import { MotionConfig } from 'motion/react'

/**
 * Thin client boundary holding the single MotionConfig root (ADR 0009 §3.2/§8).
 * reducedMotion="user" is the only place reduced motion is honored — no
 * per-component reduced-motion branches anywhere (L6).
 */
export default function MotionProviders({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
