const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'])

/**
 * True when keyboard focus is in a text field, where Cmd+Z/C/X/V must do
 * native text editing rather than the app's clip/track shortcuts. Sliders,
 * checkboxes etc. don't count — Cmd+Z after nudging a slider is an app undo.
 */
export function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type)
  return el.isContentEditable
}
