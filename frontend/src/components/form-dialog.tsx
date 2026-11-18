import { type FormEvent, type ReactNode, type RefObject, useState } from 'react'

export const secondaryButtonClass =
  'inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-black/[0.14] bg-white px-5 py-2.5 text-[15px] font-medium text-[var(--text)] transition-colors hover:bg-black/[0.04] disabled:cursor-default disabled:opacity-60 sm:min-h-12'
export const primaryButtonClass =
  'inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-[var(--text)] px-6 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-[#262626] disabled:opacity-60'
export const inputClass =
  'w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-[15px] text-[var(--text)] outline-none focus:border-[var(--text)]'

/** Busy/error state around an async action; errors become a message for the UI. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

type FormDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>
  title: string
  description: string
  submitLabel: string
  busy: boolean
  error: string | null
  notice?: string | null
  onSubmit: (form: FormData, formEl: HTMLFormElement) => void
  children: ReactNode
  footer?: ReactNode
}

export function FormDialog({
  dialogRef,
  title,
  description,
  submitLabel,
  busy,
  error,
  notice,
  onSubmit,
  children,
  footer,
}: FormDialogProps) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onSubmit(new FormData(e.currentTarget), e.currentTarget)
  }

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 backdrop:bg-black/35 backdrop:backdrop-blur-[2px] sm:p-8"
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="display-title m-0 text-xl font-medium tracking-[-0.02em] text-[var(--text)] sm:text-2xl">
          {title}
        </h2>
        <p className="m-0 mb-2 text-[15px] leading-relaxed text-[var(--text-muted)]">
          {description}
        </p>
        {children}
        {error ? (
          <p role="alert" className="m-0 text-[14px] text-red-600">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="m-0 text-[14px] text-green-700">
            {notice}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:gap-2">
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => dialogRef.current?.close()}
          >
            {notice ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {submitLabel}
          </button>
        </div>
        {footer}
      </form>
    </dialog>
  )
}
