/**
 * Build localhost stream URLs for audio files.
 *
 * `base` comes from `window.electronAPI.getAudioServerBase()` — it's
 * `http://127.0.0.1:<port>/<token>`, where the token is a per-launch secret the
 * main-process server requires on every request.
 *
 * Paths differ by platform: macOS/Linux are `/Users/…/track.mp3` (already a
 * valid URL path), but Windows paths are `C:\Users\…\track.mp3`. Concatenating
 * a Windows path straight on produced a broken URL (backslashes corrupt the
 * path), so audio never loaded on Windows. Normalise to a proper URL path:
 * backslashes → slashes, guarantee a leading slash, and encode each segment.
 * The main-process server strips the leading slash back off for Windows drive
 * paths.
 */
export function audioFileUrl(base: string, filePath: string): string {
  const slashed = filePath.replace(/\\/g, '/')
  const withLeadingSlash = slashed.startsWith('/') ? slashed : `/${slashed}`
  return base + withLeadingSlash.split('/').map(encodeURIComponent).join('/')
}

/**
 * Library / Auto-Mix variant: the `?sr=` param opts into the server's ffmpeg
 * transcode path (resampling, unsafe WAV formats, `ss` start offset). Mix's own
 * playback must use `audioFileUrl` so it streams raw with range support.
 */
export function audioStreamUrl(base: string, filePath: string, sampleRate?: number, startMs?: number): string {
  const ss = startMs && startMs > 0 ? `&ss=${(startMs / 1000).toFixed(3)}` : ''
  return `${audioFileUrl(base, filePath)}?sr=${sampleRate ?? 0}${ss}`
}

let basePromise: Promise<string> | null = null

/** The audio server base URL, fetched once per renderer lifetime. */
export function getAudioServerBase(): Promise<string> {
  basePromise ??= window.electronAPI.getAudioServerBase()
  return basePromise
}
