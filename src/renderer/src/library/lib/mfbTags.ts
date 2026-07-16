import type { MfbAudioFeatures, BreathworkPhase } from '../types'

// MFB tags arrive grouped by category ({ Hour: [...], Mood: [...] }). Slugs are
// usually { en } but detail responses can hand back a bare string.
type TagLike = { name: string; slug?: { en?: string } | string | null }
export type TagGroups = Record<string, TagLike[]>

/** Flatten grouped MFB tags to their display names. */
export function mfbTagNames(groups: TagGroups | undefined | null): string[] {
  if (!groups) return []
  return Object.values(groups).flat().map((t) => t.name)
}

/**
 * Merge the live MFB (system) tags into a file's tag list while preserving any
 * tags the user added themselves.
 *
 * A user tag is any current tag that wasn't in the *previous* MFB snapshot
 * (`existingMfbTags`). Legacy files predate the snapshot, so we fall back to the
 * fresh set — i.e. any current tag not present upstream is treated as user-owned
 * (worst case, a system tag the website removed lingers once on a legacy file;
 * the snapshot we write here makes every later sync exact).
 */
export function reconcileTags(
  existingTags: string[],
  existingMfbTags: string[] | undefined,
  freshMfbTags: string[],
): { tags: string[]; mfbTags: string[] } {
  const prevMfb = existingMfbTags ?? freshMfbTags
  const userTags = existingTags.filter((t) => !prevMfb.includes(t))
  const tags = [...freshMfbTags, ...userTags.filter((t) => !freshMfbTags.includes(t))]
  return { tags, mfbTags: freshMfbTags }
}

/** Breathwork phase carried by the MFB "Hour" tag, if present. */
export function hourPhase(groups: TagGroups | undefined | null): BreathworkPhase | null {
  const hour = groups?.['Hour']?.[0]
  if (!hour) return null
  const slug = typeof hour.slug === 'string' ? hour.slug : hour.slug?.en
  return (slug as BreathworkPhase) ?? null
}

/**
 * Whether an audio_features payload is actually populated. A track that's still
 * enriching returns an object full of nulls, which must not be applied (it would
 * render broken bars and wrongly mark the file analysed).
 */
export function hasRealFeatures(f: MfbAudioFeatures | null | undefined): f is MfbAudioFeatures {
  return !!f && Number.isFinite(f.energy) && Number.isFinite(f.intensity)
}
