import {
  clearKeys,
  createPasswordSlot,
  createSecretSlot,
  decryptJson,
  encryptJson,
  exportPublicKey,
  generateAdminKeyPair,
  generateDek,
  importPublicKey,
  loadKeys,
  openPasswordSlot,
  openSecretSlot,
  type PasswordSlot,
  saveKeys,
  toNonExtractable,
  unwrapDekAsAdmin,
  unwrapPrivateKey,
  wrapDekForAdmin,
  wrapPrivateKey,
} from './avnac-crypto'
import { getPublicApiBase } from './public-api-base'

export type CloudUser = { id: string; email: string; role: string | null }

export type AdminUser = {
  id: string
  email: string
  name: string
  role: string | null
  createdAt: string
}

export type RemoteDocumentListItem = { id: string; updatedAt: number }

type DocumentFields = {
  name: string
  document: unknown
  vectorBoards: unknown
  vectorBoardDocs: unknown
  /** Encrypted with the rest, so the server never sees folder names. */
  folder?: string
}

export type RemoteDocument = DocumentFields & {
  id: string
  updatedAt: number
  /** Stored in plaintext by an older version; re-upload it to encrypt it. */
  legacy: boolean
}

export type RemoteDocumentPayload = DocumentFields & {
  /** Server `updatedAt` this local copy is based on; null if never uploaded. */
  baseUpdatedAt: number | null
}

export type AccountLink = {
  url: string
  /** The user's files can't be recovered: they're deleted when the new password is set. */
  lossy: boolean
}

type KeyRow = PasswordSlot & { adminWrapped: string | null; resetWrapped: string | null }

export class CloudHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'CloudHttpError'
  }
}

let user: CloudUser | null = null
const listeners = new Set<() => void>()

function setUser(next: CloudUser | null) {
  user = next
  for (const listener of listeners) listener()
}

export function getCloudUser(): CloudUser | null {
  return user
}

export function subscribeCloudUser(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${getPublicApiBase()}${path}`, {
    method: init?.method ?? 'GET',
    credentials: 'include',
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    const message = data?.message ?? data?.error
    throw new CloudHttpError(
      res.status,
      typeof message === 'string' ? message : `Request failed (${res.status})`,
    )
  }
  return data as T
}

async function fetchSessionUser(): Promise<CloudUser | null> {
  const res = await api<{ data: { user: CloudUser } | null }>('/session')
  const u = res.data?.user
  return u ? { id: u.id, email: u.email, role: u.role ?? null } : null
}

export async function refreshSession(): Promise<CloudUser | null> {
  let next: CloudUser | null
  try {
    next = await fetchSessionUser()
  } catch {
    setUser(null)
    return null
  }
  // A session without this browser holding the unlocked key (e.g. first load after
  // encryption was enabled): the password is needed again to unlock the files.
  if (next?.id !== (await loadKeys())?.userId) {
    if (next) await api('/auth/sign-out', { method: 'POST', body: {} }).catch(() => {})
    await clearKeys()
    next = null
  }
  setUser(next)
  return next
}

/** `recoverySecret` comes from a reset link's #k= fragment. */
export async function signIn(
  email: string,
  password: string,
  recoverySecret?: string,
): Promise<{ newKey: boolean }> {
  if (!globalThis.crypto?.subtle) {
    // WebCrypto only exists on https:// (and localhost).
    throw new Error('Encrypted files need a secure connection: open this site over https://.')
  }
  await api('/auth/sign-in/email', { method: 'POST', body: { email, password } })
  try {
    const me = await fetchSessionUser()
    if (!me) throw new Error('Sign in failed. Try again.')
    const newKey = await unlockKeys(me, password, recoverySecret)
    await refreshSession()
    return { newKey }
  } catch (error) {
    await api('/auth/sign-out', { method: 'POST', body: {} }).catch(() => {})
    throw error
  }
}

/** Opens (or creates) the user's data key and keeps it in this browser. Returns true if new. */
async function unlockKeys(
  me: CloudUser,
  password: string,
  recoverySecret?: string,
): Promise<boolean> {
  const [{ data: row }, { data: adminKey }] = await Promise.all([
    api<{ data: KeyRow | null }>('/keys/me'),
    api<{ data: { publicKey: string; privateWrapped: string | null } | null }>('/keys/admin'),
  ])
  let adminPublic = adminKey ? await importPublicKey(adminKey.publicKey) : null
  let adminWrapped = row?.adminWrapped ?? null
  let dek: CryptoKey

  if (!row) {
    dek = await generateDek()
    adminWrapped = adminPublic ? await wrapDekForAdmin(dek, adminPublic) : null
    const slot = await createPasswordSlot(dek, password)
    await api('/keys/me', { method: 'PUT', body: { ...slot, adminWrapped } })
  } else if (row.resetWrapped && recoverySecret) {
    dek = await openSecretSlot(recoverySecret, row.resetWrapped).catch(() => {
      throw new Error('This link is no longer valid. Ask your admin for a new one.')
    })
    const slot = await createPasswordSlot(dek, password)
    await api('/keys/me', { method: 'PUT', body: { ...slot, adminWrapped } })
  } else {
    dek = await openPasswordSlot(row, password).catch(() => {
      throw new Error(
        row.resetWrapped
          ? 'Open the link your admin sent you to finish setting your password.'
          : "Your files can't be unlocked with this password.",
      )
    })
  }

  let adminPrivate: CryptoKey | undefined
  if (me.role === 'admin') {
    if (!adminKey) {
      const pair = await generateAdminKeyPair()
      const privateWrapped = await wrapPrivateKey(pair.privateKey, dek)
      const publicKey = await exportPublicKey(pair.publicKey)
      await api('/keys/admin', { method: 'PUT', body: { publicKey, privateWrapped } })
      adminPublic = pair.publicKey
      adminPrivate = await unwrapPrivateKey(privateWrapped, dek)
    } else if (adminKey.privateWrapped) {
      adminPrivate = await unwrapPrivateKey(adminKey.privateWrapped, dek).catch(() => undefined)
    }
  }

  if (!adminWrapped && adminPublic) {
    await api('/keys/me/admin-wrapped', {
      method: 'PUT',
      body: { adminWrapped: await wrapDekForAdmin(dek, adminPublic) },
    })
  }

  await saveKeys({ userId: me.id, dek: await toNonExtractable(dek), adminPrivate })
  return !row
}

export async function signOut(): Promise<void> {
  await api('/auth/sign-out', { method: 'POST', body: {} })
  await clearKeys()
  setUser(null)
}

/** Sets the password chosen through an invite/reset link (Better Auth reset token). */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api('/auth/reset-password', { method: 'POST', body: { token, newPassword } })
}

// --- Admin (Better Auth admin plugin + /keys) ---

export async function listUsers(): Promise<AdminUser[]> {
  return (
    await api<{ users: AdminUser[] }>(
      '/auth/admin/list-users?limit=1000&sortBy=createdAt&sortDirection=asc',
    )
  ).users
}

/** Creates the account without a password; the user picks one through `createAccountLink`. */
export async function createUser(input: { email: string; name: string }): Promise<string> {
  return (
    await api<{ user: { id: string } }>('/auth/admin/create-user', { method: 'POST', body: input })
  ).user.id
}

/**
 * Link where the user chooses a password: for a new account, or to reset a forgotten one.
 * For a reset, this browser opens the user's data key with the admin key and hands it over in
 * the link's #fragment (never sent to the server), so the user keeps their files.
 */
export async function createAccountLink(userId: string): Promise<AccountLink> {
  const { data: target } = await api<{ data: { hasKey: boolean; adminWrapped: string | null } }>(
    `/keys/users/${userId}`,
  )
  let secret: string | null = null
  let resetWrapped: string | null = null
  const adminPrivate = (await loadKeys())?.adminPrivate
  if (target.adminWrapped && adminPrivate) {
    const dek = await unwrapDekAsAdmin(target.adminWrapped, adminPrivate).catch(() => null)
    if (dek) ({ secret, wrapped: resetWrapped } = await createSecretSlot(dek))
  }
  const { data: link } = await api<{ data: { path: string } }>(`/keys/users/${userId}/link`, {
    method: 'POST',
    body: { resetWrapped },
  })
  const url = new URL(link.path, window.location.origin)
  if (secret) url.hash = `k=${secret}`
  return { url: url.toString(), lossy: target.hasKey && !secret }
}

/** Also deletes the user's documents (ON DELETE CASCADE). */
export async function removeUser(userId: string): Promise<void> {
  await api('/auth/admin/remove-user', { method: 'POST', body: { userId } })
}

// --- Documents: encrypted here, the server only stores ciphertext ---

async function dataKey(): Promise<CryptoKey> {
  const keys = await loadKeys()
  if (!keys || keys.userId !== user?.id) throw new Error('Files are locked: sign in again.')
  return keys.dek
}

export async function listRemoteDocuments(): Promise<RemoteDocumentListItem[]> {
  return (await api<{ data: RemoteDocumentListItem[] }>('/documents')).data
}

export async function getRemoteDocument(id: string): Promise<RemoteDocument> {
  const { data } = await api<{
    data: { updatedAt: number; encrypted?: string } & Partial<DocumentFields>
  }>(`/documents/${id}`)
  if (data.encrypted) {
    const fields = await decryptJson<DocumentFields>(await dataKey(), id, data.encrypted)
    return { ...fields, id, updatedAt: data.updatedAt, legacy: false }
  }
  return {
    id,
    updatedAt: data.updatedAt,
    name: data.name ?? 'Untitled',
    document: data.document,
    vectorBoards: data.vectorBoards ?? [],
    vectorBoardDocs: data.vectorBoardDocs ?? {},
    legacy: true,
  }
}

/** Throws CloudHttpError 409 when the server copy changed since `baseUpdatedAt`. */
export async function putRemoteDocument(
  id: string,
  { baseUpdatedAt, ...fields }: RemoteDocumentPayload,
): Promise<{ updatedAt: number }> {
  const encrypted = await encryptJson(await dataKey(), id, fields)
  return (
    await api<{ data: { updatedAt: number } }>(`/documents/${id}`, {
      method: 'PUT',
      body: { encrypted, baseUpdatedAt },
    })
  ).data
}

export async function deleteRemoteDocument(id: string): Promise<void> {
  await api(`/documents/${id}`, { method: 'DELETE' })
}
