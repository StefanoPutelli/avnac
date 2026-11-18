import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { inputClass, primaryButtonClass, useAction } from '../components/form-dialog'
import { CloudHttpError, resetPassword } from '../lib/avnac-cloud'
import { idbSignIn } from '../lib/avnac-editor-idb'

type InviteSearch = { token: string; email: string }

export const Route = createFileRoute('/invite')({
  validateSearch: (raw: Record<string, unknown>): InviteSearch => ({
    token: typeof raw.token === 'string' ? raw.token : '',
    email: typeof raw.email === 'string' ? raw.email : '',
  }),
  component: InvitePage,
})

/** The admin's browser puts the key to the user's files in #k=…, which never reaches the server. */
function recoverySecretFromHash(): string | undefined {
  return new URLSearchParams(window.location.hash.slice(1)).get('k') ?? undefined
}

function InvitePage() {
  const { token, email } = Route.useSearch()
  const navigate = useNavigate()
  const { busy, error, setError, run } = useAction()
  const [mismatch, setMismatch] = useState(false)

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password') ?? '')
    if (password !== String(form.get('confirm') ?? '')) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    void run(async () => {
      let tokenUsed = false
      try {
        await resetPassword(token, password)
      } catch (err) {
        // Already used: the password may be set but the files not unlocked yet, so retrying
        // the sign-in below finishes the job.
        if (!(err instanceof CloudHttpError && err.status === 400)) throw err
        tokenUsed = true
      }
      try {
        await idbSignIn(email, password, recoverySecretFromHash())
      } catch (err) {
        if (tokenUsed && err instanceof CloudHttpError) {
          throw new Error(
            'This link has expired or was already used. Ask your admin for a new one.',
          )
        }
        throw err
      }
      await navigate({ to: '/files' })
    })
  }

  const invalid = !token || !email

  return (
    <main className="hero-page relative flex min-h-[100dvh] flex-col overflow-hidden">
      <div className="hero-grid" aria-hidden="true" />
      <div className="relative z-[1] mx-auto w-full max-w-md flex-1 px-5 py-16 sm:py-24">
        <h1 className="display-title mb-4 text-[clamp(2rem,5vw,3rem)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--text)]">
          Choose your password
        </h1>
        {invalid ? (
          <p className="text-lg leading-[1.6] text-[var(--text-muted)]">
            This link is incomplete. Ask your admin for a new one, or{' '}
            <Link to="/files" className="text-[var(--text)] underline underline-offset-2">
              go to your files
            </Link>
            .
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <p className="m-0 mb-4 text-[15px] leading-relaxed text-[var(--text-muted)]">
              For <strong className="text-[var(--text)]">{email}</strong>. Your files are encrypted
              with a key that this password unlocks.
            </p>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="New password (min 8 characters)"
              className={inputClass}
              onChange={() => setError(null)}
            />
            <input
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Repeat password"
              className={inputClass}
            />
            {mismatch || error ? (
              <p role="alert" className="m-0 text-[14px] text-red-600">
                {mismatch ? "The passwords don't match." : error}
              </p>
            ) : null}
            <button type="submit" disabled={busy} className={`${primaryButtonClass} mt-3`}>
              {busy ? 'Setting up…' : 'Set password and sign in'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
