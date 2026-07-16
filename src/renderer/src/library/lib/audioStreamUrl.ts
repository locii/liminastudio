/**
 * Build the localhost stream URL for an audio file.
 *
 * Paths differ by platform: macOS/Linux are `/Users/…/track.mp3` (already a
 * valid URL path), but Windows paths are `C:\Users\…\track.mp3`. Concatenating
 * a Windows path straight onto the port produced a broken URL
 * (`http://127.0.0.1:52341C:%5CUsers…` — the drive letter fuses onto the port
 * and backslashes corrupt the path), so audio never loaded on Windows.
 *
 * Normalise to a proper URL path: backslashes → slashes, guarantee a leading
 * slash, and encode each segment. The main-process server strips the leading
 * slash back off for Windows drive paths.
 */
export function audioStreamUrl(port: number, filePath: string, sampleRate?: number, startMs?: number): string {
  const slashed = filePath.replace(/\\/g, '/')
  const withLeadingSlash = slashed.startsWith('/') ? slashed : `/${slashed}`
  const encoded = withLeadingSlash.split('/').map(encodeURIComponent).join('/')
  const ss = startMs && startMs > 0 ? `&ss=${(startMs / 1000).toFixed(3)}` : ''
  return `http://127.0.0.1:${port}${encoded}?sr=${sampleRate ?? 0}${ss}`
}
