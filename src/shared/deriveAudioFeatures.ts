import type { MfbAudioFeatures } from './types'

/**
 * Local port of Music for Breathwork's `AudioFeatures` service (PHP).
 *
 * Reccobeats (or Spotify) gives us the three perceptual base features
 * — valence, energy, danceability — plus tempo and key mode. From those we
 * derive the same composite features the MFB catalogue exposes, so locally
 * analysed tracks slot into the Feel EQ on the same scale as catalogue tracks.
 *
 * NOTE: the MFB service also folds in per-tag weights (tension_weight, etc.)
 * via `applyTagBlend`. Local files have no MFB tags, so we compute the raw
 * audio base only — the un-blended value. Keep the formulas below in sync with
 * `app/Services/AudioFeatures.php` if they change upstream.
 */

export interface BaseAudioFeatures {
  valence: number
  energy: number
  danceability: number
  tempo: number
  /** Spotify/Reccobeats key mode: 1 = major, 0 = minor. Defaults to major when absent. */
  mode?: number
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
const round = (v: number, d = 4): number => {
  const p = 10 ** d
  return Math.round(v * p) / p
}

// --- Label band cutoffs (mirror AudioFeatures.php constants) ----------------

function tempoLabel(tempo: number): string {
  if (tempo <= 60) return 'Very Slow'
  if (tempo <= 90) return 'Slow'
  if (tempo <= 120) return 'Medium'
  if (tempo <= 150) return 'Fast'
  return 'Very Fast'
}

function energyLabel(energy: number): string {
  if (energy <= 0.2) return 'Very Low Energy'
  if (energy <= 0.4) return 'Low Energy'
  if (energy <= 0.6) return 'Medium Energy'
  if (energy <= 0.8) return 'High Energy'
  return 'Very High Energy'
}

function valenceLabel(valence: number): string {
  if (valence <= 0.08) return 'Very Sad'
  if (valence <= 0.24) return 'Sad'
  if (valence <= 0.45) return 'Neutral'
  if (valence <= 0.6) return 'Happy'
  return 'Very Happy'
}

function danceabilityLabel(dance: number): string {
  if (dance <= 0.2) return 'Sparse Rhythm'
  if (dance <= 0.4) return 'Dense Rhythm'
  if (dance <= 0.6) return 'Moderately Danceable'
  if (dance <= 0.8) return 'Danceable'
  return 'Very Danceable'
}

/**
 * Derive the full MfbAudioFeatures set from base perceptual features.
 * Composite formulas are the un-blended audio bases from AudioFeatures.php.
 */
export function deriveAudioFeatures(base: BaseAudioFeatures): MfbAudioFeatures {
  const valence = clamp01(base.valence)
  const energy = clamp01(base.energy)
  const dance = clamp01(base.danceability)
  const tempo = Number.isFinite(base.tempo) ? base.tempo : 0
  const minor = base.mode === 0 ? 1 : 0

  // affective_intensity = (|valence − 0.5| × 2)²
  const affective = round(Math.pow(Math.abs(valence - 0.5) * 2, 2))
  // activation_intensity = √(energy² + dance²) ÷ √2
  const activation = round(Math.sqrt(energy ** 2 + dance ** 2) / Math.SQRT2)
  // intensity = √(0.25·affective² + 0.75·activation²)
  const intensity = round(Math.sqrt(0.25 * affective ** 2 + 0.75 * activation ** 2))
  // spaciousness = (1 − density)^1.5,  density = 0.6·energy + 0.4·dance
  const density = 0.6 * energy + 0.4 * dance
  const spaciousness = round(Math.pow(Math.max(0, 1 - density), 1.5))
  // tension = (1 − valence) × (0.2 + 0.5·energy + 0.3·minor)
  const tension = round((1 - valence) * (0.2 + 0.5 * energy + 0.3 * minor))

  return {
    intensity,
    activation_intensity: activation,
    affective_intensity: affective,
    tempo: round(tempo, 2),
    tempo_label: tempoLabel(tempo),
    energy: round(energy),
    energy_label: energyLabel(energy),
    valence: round(valence),
    valence_label: valenceLabel(valence),
    danceability: round(dance),
    danceability_label: danceabilityLabel(dance),
    spaciousness,
    tension,
  }
}
