import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toUtcIso(d: Date): string {
  // eslint-disable-next-line no-restricted-properties -- the one sanctioned native call; see CLAUDE.md date rule
  return d.toISOString()
}
