/**
 * The message from an error thrown in a main-process IPC handler, without the
 * "Error invoking remote method 'x': Error: " wrapper Electron adds.
 */
export function ipcErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/, '')
}
