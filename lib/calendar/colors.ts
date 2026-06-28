/**
 * Deterministic campaign colour palette index (CAL-1).
 * Mechanism only — hex values live in the design/UI layer.
 */

// FNV-1a 32-bit hash: fast, well-distributed, no crypto dependency.
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    // Multiply by FNV prime (2^24 + 2^8 + 0x93), keep to 32-bit unsigned
    hash = (hash * 0x01000193) >>> 0
  }
  return hash
}

/**
 * Maps a campaign UUID to a palette slot index in [0, paletteLength).
 * Stable across calls and sessions — never stored (CAL-1).
 */
export function colorIndex(campaignId: string, paletteLength: number): number {
  return fnv1a32(campaignId) % paletteLength
}
