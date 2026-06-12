'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Canonical section entrance wrapper (ADR 0009 §8, Amendment A1).
 * CSS-only reveals: this component never animates on the main thread — it
 * toggles `data-reveal` and the transition in globals.css does the rest.
 *
 * The hidden state is applied exclusively from JS *after* mount, and only to
 * elements still below the viewport, so server-rendered HTML is always fully
 * visible (no-JS visitors, crawlers, and reduced-motion users see content
 * instantly in place).
 */

const NEAR_VIEWPORT_FRACTION = 0.9

function useReveal<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Already in (or near) view at hydration — render in place, no entrance.
    if (el.getBoundingClientRect().top < window.innerHeight * NEAR_VIEWPORT_FRACTION) return

    el.setAttribute('data-reveal', 'pending')
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          el.removeAttribute('data-reveal')
          observer.disconnect()
        }
      },
      // §8: animate once, slightly before fully in view.
      { rootMargin: '-10% 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}

export function Section({
  id,
  className,
  children,
}: {
  id?: string
  className?: string
  children: React.ReactNode
}) {
  const ref = useReveal<HTMLElement>()
  return (
    <section ref={ref} id={id} className={cn('reveal', className)}>
      {children}
    </section>
  )
}

/**
 * Staggered child entrance (§8: default 80ms between grouped children,
 * 40ms for dense lists like pricing feature rows). Children transition at
 * 0.4s (`.reveal-child`) so small elements feel crisp, not syrupy.
 */
export function StaggerItem({
  index,
  stepMs = 80,
  className,
  children,
}: {
  index: number
  stepMs?: number
  className?: string
  children: React.ReactNode
}) {
  const ref = useReveal<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={cn('reveal reveal-child', className)}
      style={{ '--reveal-delay': `${index * stepMs}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
