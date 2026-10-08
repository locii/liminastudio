import { shell } from 'electron'

// Schemes that are safe to hand to the OS. Anything else (file:, smb:,
// search-ms:, ms-msdt:, custom app handlers…) can launch local programs, and
// URLs reach here from catalogue/API data the app doesn't control.
const ALLOWED_SCHEMES = new Set(['https:', 'http:', 'mailto:'])

export async function safeOpenExternal(url: string): Promise<void> {
  let parsed: URL
  try { parsed = new URL(url) } catch {
    console.warn('[openExternal] refused unparseable URL')
    return
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    console.warn('[openExternal] refused scheme', parsed.protocol)
    return
  }
  await shell.openExternal(parsed.toString())
}
