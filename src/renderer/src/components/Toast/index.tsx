import { useToastStore } from '../../store/toastStore'
import type { Toast } from '../../store/toastStore'

export function ToastContainer(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts)
  const remove = useToastStore((s) => s.remove)

  return (
    <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-[100] pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }): JSX.Element {
  const bg =
    toast.type === 'error'
      ? 'bg-red-900/90 border-red-700'
      : toast.type === 'success'
      ? 'bg-green-900/90 border-green-700'
      : 'bg-surface-panel border-surface-border'

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-lg border shadow-xl text-sm text-gray-200 animate-fade-in ${bg}`}
    >
      <span className="flex-1">{toast.message}</span>
      <button onClick={onClose} className="text-gray-500 hover:text-gray-300 leading-none text-xs">
        ✕
      </button>
    </div>
  )
}
