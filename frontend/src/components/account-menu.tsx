import { Link } from '@tanstack/react-router'
import { useRef, useSyncExternalStore } from 'react'
import { getCloudUser, subscribeCloudUser } from '../lib/avnac-cloud'
import { idbSignIn, idbSignOut } from '../lib/avnac-editor-idb'
import { FormDialog, inputClass, secondaryButtonClass, useAction } from './form-dialog'

type AccountMenuProps = {
  /** Called after sign in / sign out, once local files reflect the new account. */
  onChange: () => void
  signInButtonClassName?: string
}

export default function AccountMenu({
  onChange,
  signInButtonClassName = secondaryButtonClass,
}: AccountMenuProps) {
  const user = useSyncExternalStore(subscribeCloudUser, getCloudUser)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const signInAction = useAction()
  const signOutAction = useAction()

  const submit = (form: FormData) =>
    signInAction.run(async () => {
      await idbSignIn(String(form.get('email') ?? '').trim(), String(form.get('password') ?? ''))
      dialogRef.current?.close()
      onChange()
    })

  const logout = () =>
    signOutAction.run(async () => {
      await idbSignOut()
      onChange()
    })

  if (user) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden max-w-[14rem] truncate text-[14px] text-[var(--text-muted)] sm:inline">
          {user.email}
        </span>
        {user.role === 'admin' ? (
          <Link to="/admin" className={`${secondaryButtonClass} no-underline`}>
            Admin
          </Link>
        ) : null}
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={signOutAction.busy}
          title={signOutAction.error ?? undefined}
          onClick={logout}
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        className={signInButtonClassName}
        onClick={() => {
          signInAction.setError(null)
          dialogRef.current?.showModal()
        }}
      >
        Sign in
      </button>
      <FormDialog
        dialogRef={dialogRef}
        title="Sign in"
        description="Your files are saved on this server, so they survive clearing browser data and show up on your other devices."
        submitLabel="Sign in"
        busy={signInAction.busy}
        error={signInAction.error}
        onSubmit={submit}
        footer={
          <p className="m-0 mt-1 self-center text-[14px] text-[var(--text-muted)]">
            Accounts are created by your admin.
          </p>
        }
      >
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          className={inputClass}
        />
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          className={inputClass}
        />
      </FormDialog>
    </>
  )
}
