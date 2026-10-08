import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

// Open dialogs, innermost last — only the top one reacts to Escape/Tab.
const stack: symbol[] = []

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Shared modal behaviour: Escape closes (and doesn't leak through to the
 * workspace's own Escape shortcut — e.g. Mix deselecting the clip behind the
 * dialog), Tab stays inside the dialog, and focus returns to wherever it was
 * when the dialog closes.
 *
 * Attach the returned ref to the dialog panel and spread `dialogProps` on it.
 * Pass `canClose: false` while the dialog must not be dismissed (e.g. mid-export).
 */
export function useDialog(
  open: boolean,
  onClose: () => void,
  canClose = true,
): { ref: RefObject<HTMLDivElement>; dialogProps: { role: 'dialog'; 'aria-modal': true } } {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const canCloseRef = useRef(canClose)
  onCloseRef.current = onClose
  canCloseRef.current = canClose

  useEffect(() => {
    if (!open) return
    const id = Symbol('dialog')
    stack.push(id)
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Move focus into the dialog unless something inside already has it.
    requestAnimationFrame(() => {
      const el = ref.current
      if (el && !el.contains(document.activeElement)) {
        const first = el.querySelector<HTMLElement>(FOCUSABLE)
        ;(first ?? el).focus({ preventScroll: true })
      }
    })

    const onKeyDown = (e: KeyboardEvent): void => {
      if (stack[stack.length - 1] !== id) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (canCloseRef.current) onCloseRef.current()
        return
      }
      if (e.key === 'Tab') {
        const el = ref.current
        if (!el) return
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null)
        if (items.length === 0) { e.preventDefault(); return }
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus() }
      }
    }
    // Capture phase so it runs before any surface-level keydown handler.
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true })
    }
  }, [open])

  return { ref, dialogProps: { role: 'dialog', 'aria-modal': true } }
}
