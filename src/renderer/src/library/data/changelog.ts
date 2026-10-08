// The in-app "What's New" is generated from CHANGELOG.md (the same file the
// release workflow turns into GitHub release notes), so there's one source of
// truth. The modal previously showed a hand-kept list left over from the
// standalone Library app (v2.x), which didn't match the Limina Studio version.
import changelogMd from '../../../../../CHANGELOG.md?raw'

export interface ChangelogEntry {
  version: string
  date: string
  sections: {
    icon: string
    title: string
    items: string[]
  }[]
}

/**
 * Parse CHANGELOG.md: each `## vX.Y.Z` heading is a version, and each
 * `- **Title** — description` bullet becomes one titled section.
 */
export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let current: ChangelogEntry | null = null
  for (const line of md.split('\n')) {
    const heading = line.match(/^##\s+v?(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(.+))?$/)
    if (heading) {
      current = { version: heading[1], date: heading[2]?.trim() ?? '', sections: [] }
      entries.push(current)
      continue
    }
    const bullet = line.match(/^-\s+(?:\*\*(.+?)\*\*\s*(?:[—–:-]\s*)?)?(.*)$/)
    if (bullet && current) {
      const title = bullet[1]?.trim() ?? ''
      const body = bullet[2].trim()
      current.sections.push({ icon: '✧', title: title || body, items: title && body ? [body] : [] })
    }
  }
  return entries
}

export const CHANGELOG: ChangelogEntry[] = parseChangelog(changelogMd)
