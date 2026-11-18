import { createFileRoute, Link } from '@tanstack/react-router'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import DeleteConfirmDialog from '../components/delete-confirm-dialog'
import {
  FormDialog,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  useAction,
} from '../components/form-dialog'
import {
  type AccountLink,
  type AdminUser,
  createAccountLink,
  createUser,
  getCloudUser,
  listUsers,
  refreshSession,
  removeUser,
  subscribeCloudUser,
} from '../lib/avnac-cloud'

export const Route = createFileRoute('/admin')({
  component: AdminPage,
})

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function AdminPage() {
  const me = useSyncExternalStore(subscribeCloudUser, getCloudUser)
  const isAdmin = me?.role === 'admin'
  const [sessionChecked, setSessionChecked] = useState(false)
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const createRef = useRef<HTMLDialogElement>(null)
  const createAction = useAction()
  const linkRef = useRef<HTMLDialogElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const linkAction = useAction()
  const [link, setLink] = useState<(AccountLink & { email: string; invite: boolean }) | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)

  useEffect(() => {
    void refreshSession().finally(() => setSessionChecked(true))
  }, [])

  const refresh = useCallback(() => {
    void listUsers()
      .then(list => {
        setUsers(list)
        setPageError(null)
      })
      .catch(err => setPageError(err instanceof Error ? err.message : 'Could not load users.'))
  }, [])

  useEffect(() => {
    if (isAdmin) refresh()
  }, [isAdmin, refresh])

  const showLink = (next: NonNullable<typeof link>) => {
    setLink(next)
    setCopied(null)
    linkRef.current?.showModal()
  }

  const submitCreate = (form: FormData, formEl: HTMLFormElement) =>
    createAction.run(async () => {
      const email = String(form.get('email') ?? '').trim()
      const userId = await createUser({
        email,
        name: String(form.get('name') ?? '').trim() || email.split('@')[0] || email,
      })
      formEl.reset()
      createRef.current?.close()
      refresh()
      showLink({ ...(await createAccountLink(userId)), email, invite: true })
    })

  const requestResetLink = (target: AdminUser) =>
    void linkAction.run(async () => {
      showLink({ ...(await createAccountLink(target.id)), email: target.email, invite: false })
    })

  const copyLink = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied('Link copied.')
    } catch {
      // Clipboard API needs https (or localhost).
      linkInputRef.current?.select()
      setCopied('Press Ctrl+C (or ⌘C) to copy the selected link.')
    }
  }

  const confirmDelete = () => {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target) return
    void removeUser(target.id)
      .then(refresh)
      .catch(err => setPageError(err instanceof Error ? err.message : 'Could not delete user.'))
  }

  let body: ReactNode
  if (!sessionChecked && !me) {
    body = <p className="text-lg text-[var(--text-muted)]">Loading…</p>
  } else if (!isAdmin) {
    body = (
      <p className="text-lg leading-[1.6] text-[var(--text-muted)]">
        Admins only.{' '}
        <Link to="/files" className="text-[var(--text)] underline underline-offset-2">
          {me ? 'Back to files' : 'Sign in from the files page'}
        </Link>
      </p>
    )
  } else {
    body = (
      <>
        <div className="mb-6 flex items-center justify-between gap-4">
          <p className="m-0 text-lg text-[var(--text-muted)]">
            {users ? `${users.length} ${users.length === 1 ? 'user' : 'users'}` : 'Loading…'}
          </p>
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => {
              createAction.setError(null)
              createRef.current?.showModal()
            }}
          >
            New user
          </button>
        </div>
        {pageError || linkAction.error ? (
          <p className="mb-4 text-base text-red-600">{pageError ?? linkAction.error}</p>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {users?.map(u => (
            <li
              key={u.id}
              className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
            >
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium text-[var(--text)]">
                  {u.email}
                  {u.role === 'admin' ? (
                    <span className="ml-2 rounded-full bg-black/[0.06] px-2 py-0.5 text-[12px] font-medium text-[var(--text-muted)]">
                      admin
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-[13px] text-[var(--text-muted)]">
                  {u.name} · created {formatDate(u.createdAt)}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={linkAction.busy}
                  onClick={() => requestResetLink(u)}
                >
                  Reset link
                </button>
                {u.id !== me?.id ? (
                  <button
                    type="button"
                    className={`${secondaryButtonClass} text-red-600`}
                    onClick={() => setDeleteTarget(u)}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <main className="hero-page relative flex min-h-[100dvh] flex-col overflow-hidden">
      <div className="hero-grid" aria-hidden="true" />
      <div className="relative z-[1] mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        <Link
          to="/files"
          className="text-[15px] text-[var(--text-muted)] no-underline hover:text-[var(--text)]"
        >
          ← Files
        </Link>
        <h1 className="display-title mb-10 mt-4 text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--text)]">
          Users
        </h1>
        {body}
      </div>

      <FormDialog
        dialogRef={createRef}
        title="New user"
        description="You'll get a link to send them: they choose their own password there."
        submitLabel="Create user"
        busy={createAction.busy}
        error={createAction.error}
        onSubmit={submitCreate}
      >
        <input
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="Email"
          className={inputClass}
        />
        <input
          name="name"
          type="text"
          autoComplete="off"
          placeholder="Name"
          className={inputClass}
        />
      </FormDialog>

      <FormDialog
        dialogRef={linkRef}
        title={link?.invite ? 'Invite link' : 'Reset link'}
        description={`Send this link to ${link?.email ?? ''}: they choose ${
          link?.invite ? 'their' : 'a new'
        } password there. It works once and expires in 7 days.${
          link?.invite ? '' : ' Their devices are signed out once the new password is set.'
        }`}
        submitLabel="Copy link"
        busy={false}
        error={
          link?.lossy
            ? "This user's files can't be recovered with this link: they will be deleted when the new password is set."
            : null
        }
        notice={copied}
        onSubmit={() => void copyLink()}
      >
        <input
          ref={linkInputRef}
          readOnly
          value={link?.url ?? ''}
          aria-label="Link"
          className={inputClass}
          onFocus={e => e.currentTarget.select()}
        />
      </FormDialog>

      <DeleteConfirmDialog
        open={deleteTarget != null}
        title="Delete user"
        message={`${deleteTarget?.email ?? ''} and all their files will be permanently deleted.`}
        confirmLabel="Delete user"
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </main>
  )
}
