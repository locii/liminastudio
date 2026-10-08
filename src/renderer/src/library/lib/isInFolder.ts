/**
 * True when `filePath` lives inside `folderPath` (at any depth).
 *
 * A bare `startsWith(folderPath)` also matches sibling folders that share a
 * prefix — `/Music/Breath` would claim files from `/Music/Breathwork2` — so
 * require a path separator right after the folder path.
 */
export function isInFolder(filePath: string, folderPath: string): boolean {
  const folder = folderPath.replace(/[\\/]+$/, '')
  if (!filePath.startsWith(folder)) return false
  const next = filePath.charAt(folder.length)
  return next === '/' || next === '\\'
}
