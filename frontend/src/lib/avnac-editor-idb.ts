import {
  CloudHttpError,
  deleteRemoteDocument,
  getCloudUser,
  getRemoteDocument,
  listRemoteDocuments,
  putRemoteDocument,
  type RemoteDocument,
  refreshSession,
  signIn,
  signOut,
} from './avnac-cloud'
import {
  type AvnacDocument,
  type AvnacDocumentStorageKind,
  cloneAvnacDocument,
  getAvnacDocumentStorageKind,
  parseAvnacDocument,
} from './avnac-document'
import type { VectorBoardDocument } from './avnac-vector-board-document'
import {
  type AvnacVectorBoardMeta,
  clearAvnacVectorBoardStorage,
  loadVectorBoardDocs,
  loadVectorBoards,
  saveVectorBoardDocs,
  saveVectorBoards,
} from './avnac-vector-boards-storage'

const DB_NAME = 'avnac-editor'
const DB_VERSION = 1
const STORE = 'documents'
const CLOUD_PUSH_DEBOUNCE_MS = 2000

export type AvnacEditorIdbRecord = {
  id: string
  updatedAt: number
  document: AvnacDocument
  storageKind: Exclude<AvnacDocumentStorageKind, 'invalid'>
  /** User-visible file name (optional on legacy rows). */
  name?: string
  owner?: string
  folder?: string
}

type StoredAvnacEditorIdbRecord = {
  id: string
  updatedAt: number
  document: unknown
  name?: string
  /** Account (user id) the file syncs to; missing = only in this browser. */
  owner?: string
  /** Folder name; missing = top level. */
  folder?: string
  /** `false` once the server has this exact version; missing on rows from before cloud sync. */
  dirty?: boolean
  /** Server `updatedAt` of the last successful sync. */
  syncedAt?: number
}

function normalizeEditorRecord(
  row: StoredAvnacEditorIdbRecord | null | undefined,
): AvnacEditorIdbRecord | null {
  if (!row || typeof row.id !== 'string') return null
  const storageKind = getAvnacDocumentStorageKind(row.document)
  if (storageKind === 'invalid') return null
  const document = parseAvnacDocument(row.document)
  if (!document) return null
  return {
    id: row.id,
    updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : Date.now(),
    document,
    storageKind,
    name: typeof row.name === 'string' ? row.name : undefined,
    owner: row.owner,
    folder: row.folder,
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
  })
}

async function rawGet(id: string): Promise<StoredAvnacEditorIdbRecord | null> {
  const db = await openDb()
  try {
    return await new Promise<StoredAvnacEditorIdbRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      tx.onerror = () => reject(tx.error ?? new Error('idb read failed'))
      const r = tx.objectStore(STORE).get(id)
      r.onerror = () => reject(r.error ?? new Error('idb get failed'))
      r.onsuccess = () => resolve((r.result as StoredAvnacEditorIdbRecord | undefined) ?? null)
    })
  } finally {
    db.close()
  }
}

async function rawGetAll(): Promise<StoredAvnacEditorIdbRecord[]> {
  const db = await openDb()
  try {
    return await new Promise<StoredAvnacEditorIdbRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      tx.onerror = () => reject(tx.error ?? new Error('idb list failed'))
      const r = tx.objectStore(STORE).getAll()
      r.onerror = () => reject(r.error ?? new Error('idb getAll failed'))
      r.onsuccess = () => resolve(r.result as StoredAvnacEditorIdbRecord[])
    })
  } finally {
    db.close()
  }
}

/** Read-modify-write in one transaction so autosave and sync writes can't interleave. */
async function rawUpdate(
  id: string,
  update: (prev: StoredAvnacEditorIdbRecord | null) => StoredAvnacEditorIdbRecord | null,
): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.onerror = () => reject(tx.error ?? new Error('idb write failed'))
      tx.onabort = () => reject(tx.error ?? new Error('idb write aborted'))
      tx.oncomplete = () => resolve()
      const store = tx.objectStore(STORE)
      const r = store.get(id)
      r.onsuccess = () => {
        const next = update((r.result as StoredAvnacEditorIdbRecord | undefined) ?? null)
        if (next) store.put(next)
      }
    })
  } finally {
    db.close()
  }
}

async function rawDelete(id: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'))
      tx.oncomplete = () => resolve()
      tx.objectStore(STORE).delete(id)
    })
  } finally {
    db.close()
  }
  clearAvnacVectorBoardStorage(id)
}

/** Strictly increasing so "changed since the upload started" is always detectable. */
function nextUpdatedAt(prev: StoredAvnacEditorIdbRecord | null): number {
  return Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1)
}

export async function idbGetEditorRecord(id: string): Promise<AvnacEditorIdbRecord | null> {
  await cloudReady()
  return normalizeEditorRecord(await rawGet(id))
}

export async function idbGetDocument(id: string): Promise<AvnacDocument | null> {
  const row = await idbGetEditorRecord(id)
  return row?.document ?? null
}

export type AvnacEditorIdbListItem = {
  id: string
  name: string
  updatedAt: number
  artboardWidth: number
  artboardHeight: number
  isLegacy: boolean
  /** Signed in, but this file is only in this browser (not in the account). */
  local: boolean
  folder: string | null
}

export async function idbListDocuments(): Promise<AvnacEditorIdbListItem[]> {
  await cloudReady()
  const user = getCloudUser()
  const items: AvnacEditorIdbListItem[] = (await rawGetAll())
    .map(row => normalizeEditorRecord(row))
    .filter((row): row is AvnacEditorIdbRecord => row != null)
    .map(row => ({
      id: row.id,
      name: row.name?.trim() || 'Untitled',
      updatedAt: row.updatedAt,
      artboardWidth: row.document.artboard.width,
      artboardHeight: row.document.artboard.height,
      isLegacy: row.storageKind === 'legacy',
      local: user !== null && row.owner !== user.id,
      folder: row.folder ?? null,
    }))
  items.sort((a, b) => b.updatedAt - a.updatedAt)
  return items
}

export async function idbPutDocument(
  id: string,
  document: AvnacDocument,
  opts?: { name?: string; folder?: string },
): Promise<void> {
  await cloudReady()
  let changed = false
  await rawUpdate(id, prev => {
    const name =
      opts && opts.name !== undefined
        ? opts.name.trim() || 'Untitled'
        : prev?.name?.trim() || 'Untitled'
    // Opening a file autosaves it unchanged: don't bump it, or two devices opening the same
    // file would both upload and one would get a spurious conflict copy.
    if (prev && prev.name === name && JSON.stringify(prev.document) === JSON.stringify(document)) {
      return null
    }
    changed = true
    return {
      id,
      updatedAt: nextUpdatedAt(prev),
      document,
      name,
      // New files join the signed-in account; files made while signed out stay local.
      owner: prev ? prev.owner : getCloudUser()?.id,
      folder: prev ? prev.folder : opts?.folder || undefined,
      dirty: true,
      syncedAt: prev?.syncedAt,
    }
  })
  if (changed) scheduleCloudPush(id)
}

/** `folder: null` moves the files back to the top level. */
export async function idbMoveDocuments(ids: string[], folder: string | null): Promise<void> {
  for (const id of ids) {
    let moved = false
    // ponytail: moving counts as an edit (bumps updatedAt), since sync detects changes by it.
    await rawUpdate(id, prev => {
      if (!prev || (prev.folder ?? null) === folder) return null
      moved = true
      return {
        ...prev,
        folder: folder ?? undefined,
        updatedAt: nextUpdatedAt(prev),
        dirty: true,
      }
    })
    if (moved) scheduleCloudPush(id)
  }
}

/** For changes stored outside the record (vector boards in localStorage). */
export async function idbMarkDirty(id: string): Promise<void> {
  await rawUpdate(id, prev => prev && { ...prev, updatedAt: nextUpdatedAt(prev), dirty: true })
  scheduleCloudPush(id)
}

export async function idbSetDocumentName(id: string, name: string): Promise<void> {
  const row = await idbGetEditorRecord(id)
  if (!row) return
  await idbPutDocument(id, row.document, { name })
}

export async function idbDeleteDocument(id: string): Promise<void> {
  window.clearTimeout(pushTimers.get(id))
  pushTimers.delete(id)
  await rawDelete(id)
  if (!getCloudUser()) return
  // ponytail: best effort; if this fails (offline) the next sync downloads the file again.
  void deleteRemoteDocument(id).catch(error => {
    if (!(error instanceof CloudHttpError && error.status === 404)) {
      console.warn('[avnac] cloud delete failed', error)
    }
  })
}

export async function idbDuplicateDocument(sourceId: string): Promise<string | null> {
  const row = await idbGetEditorRecord(sourceId)
  if (!row) return null
  const newId = crypto.randomUUID()
  const baseName = row.name?.trim() || 'Untitled'
  const name = `${baseName} copy`
  const docClone = cloneAvnacDocument(row.document)
  await idbPutDocument(newId, docClone, { name, folder: row.folder })

  const boards = loadVectorBoards(sourceId)
  const docs = loadVectorBoardDocs(sourceId)
  if (boards.length > 0) {
    saveVectorBoards(newId, JSON.parse(JSON.stringify(boards)) as typeof boards)
  }
  if (Object.keys(docs).length > 0) {
    saveVectorBoardDocs(
      newId,
      JSON.parse(JSON.stringify(docs)) as Record<string, VectorBoardDocument>,
    )
  }
  return newId
}

export async function idbMigrateLegacyDocument(id: string): Promise<boolean> {
  const row = await idbGetEditorRecord(id)
  if (!row) return false
  if (row.storageKind !== 'legacy') return true
  await idbPutDocument(id, row.document, { name: row.name })
  return true
}

// --- Cloud sync -------------------------------------------------------------
// IndexedDB stays the source the UI reads from; when signed in, every local write is
// uploaded (debounced) and a full sync runs on page load and when /files opens.
// ponytail: no live sync between tabs/devices open at the same time; changes show up on reload.

const pushTimers = new Map<string, number>()
const pushChains = new Map<string, Promise<void>>()
let cloudSync: Promise<void> | null = null
let cloudSyncSettled = false

function cloudReady(): Promise<void> {
  if (!cloudSync) {
    cloudSyncSettled = false
    cloudSync = syncWithCloud()
      .catch(error => console.warn('[avnac] cloud sync failed', error))
      .finally(() => {
        cloudSyncSettled = true
      })
  }
  return cloudSync
}

/** Pull changes from other devices and upload pending ones (reuses a sync still running). */
export function resyncCloud(): Promise<void> {
  if (cloudSyncSettled) cloudSync = null
  return cloudReady()
}

/** What a full sync does with one document id. */
export function cloudSyncAction(
  local: Pick<StoredAvnacEditorIdbRecord, 'dirty' | 'syncedAt'> | undefined,
  remoteUpdatedAt: number | undefined,
): 'push' | 'download' | 'delete-local' | 'none' {
  const dirty = local !== undefined && local.dirty !== false
  if (remoteUpdatedAt === undefined) {
    if (!local) return 'none'
    // Clean and synced before, now gone from the server: deleted on another device.
    return dirty ? 'push' : 'delete-local'
  }
  // A server change since `syncedAt` comes back as 409 and becomes a conflict copy.
  if (dirty) return 'push'
  return local?.syncedAt === remoteUpdatedAt ? 'none' : 'download'
}

async function syncWithCloud(): Promise<void> {
  const me = await refreshSession()
  if (!me) return
  const remote = new Map((await listRemoteDocuments()).map(item => [item.id, item.updatedAt]))
  const rows = await rawGetAll()
  for (const row of rows) {
    // Uploaded before rows recorded their account.
    if (row.owner === undefined && remote.has(row.id)) {
      row.owner = me.id
      await rawUpdate(row.id, cur => cur && { ...cur, owner: me.id })
    }
  }
  // Files only in this browser stay out of the sync until uploaded (idbUploadLocalDocuments).
  const local = new Map(rows.filter(row => row.owner === me.id).map(row => [row.id, row]))
  for (const id of new Set([...remote.keys(), ...local.keys()])) {
    try {
      const action = cloudSyncAction(local.get(id), remote.get(id))
      if (action === 'push') await pushToCloud(id)
      else if (action === 'download') {
        const remote = await getRemoteDocument(id)
        await applyRemoteDocument(remote)
        if (remote.legacy) await pushToCloud(id)
      } else if (action === 'delete-local') await rawDelete(id)
    } catch (error) {
      console.warn('[avnac] cloud sync failed for', id, error)
    }
  }
}

function scheduleCloudPush(id: string) {
  if (!getCloudUser()) return
  window.clearTimeout(pushTimers.get(id))
  pushTimers.set(
    id,
    window.setTimeout(() => {
      pushTimers.delete(id)
      void pushToCloud(id)
    }, CLOUD_PUSH_DEBOUNCE_MS),
  )
}

/** Uploads are chained per document so two never race on the same base version. */
function pushToCloud(id: string): Promise<void> {
  const next = (pushChains.get(id) ?? Promise.resolve())
    .then(() => pushOnce(id))
    .catch(error => console.warn('[avnac] cloud upload failed', error))
  pushChains.set(id, next)
  void next.finally(() => {
    if (pushChains.get(id) === next) pushChains.delete(id)
  })
  return next
}

async function pushOnce(id: string, afterConflict = false): Promise<void> {
  const user = getCloudUser()
  if (!user) return
  const row = await rawGet(id)
  if (!row || row.dirty === false || row.owner !== user.id) return
  try {
    const { updatedAt } = await putRemoteDocument(id, {
      name: row.name?.trim() || 'Untitled',
      document: row.document,
      vectorBoards: loadVectorBoards(id),
      vectorBoardDocs: loadVectorBoardDocs(id),
      folder: row.folder,
      baseUpdatedAt: row.syncedAt ?? null,
    })
    // Edits made during the upload keep the row dirty for the next push.
    await rawUpdate(
      id,
      cur => cur && { ...cur, syncedAt: updatedAt, dirty: cur.updatedAt !== row.updatedAt },
    )
  } catch (error) {
    if (afterConflict || !(error instanceof CloudHttpError) || error.status !== 409) throw error
    // Edited on another device too: keep that version as a separate file; local edits win here.
    const remote = await getRemoteDocument(id)
    await saveConflictCopy(remote)
    await rawUpdate(id, cur => cur && { ...cur, syncedAt: remote.updatedAt })
    await pushOnce(id, true)
  }
}

function writeRemoteVectorBoards(id: string, remote: RemoteDocument) {
  saveVectorBoards(
    id,
    Array.isArray(remote.vectorBoards) ? (remote.vectorBoards as AvnacVectorBoardMeta[]) : [],
  )
  saveVectorBoardDocs(
    id,
    remote.vectorBoardDocs && typeof remote.vectorBoardDocs === 'object'
      ? (remote.vectorBoardDocs as Record<string, VectorBoardDocument>)
      : {},
  )
}

async function applyRemoteDocument(remote: RemoteDocument): Promise<void> {
  writeRemoteVectorBoards(remote.id, remote)
  await rawUpdate(remote.id, () => ({
    id: remote.id,
    updatedAt: remote.updatedAt,
    document: remote.document,
    name: remote.name,
    folder: remote.folder,
    owner: getCloudUser()?.id,
    // Plaintext on the server: upload it again so it gets stored encrypted.
    dirty: remote.legacy,
    syncedAt: remote.updatedAt,
  }))
}

async function saveConflictCopy(remote: RemoteDocument): Promise<void> {
  const id = crypto.randomUUID()
  writeRemoteVectorBoards(id, remote)
  await rawUpdate(id, () => ({
    id,
    updatedAt: Date.now(),
    document: remote.document,
    name: `${remote.name} (conflict)`,
    folder: remote.folder,
    owner: getCloudUser()?.id,
    dirty: true,
  }))
  void pushToCloud(id)
}

/** Moves files kept only in this browser into the signed-in account. */
export async function idbUploadLocalDocuments(ids: string[]): Promise<void> {
  const user = getCloudUser()
  if (!user) return
  for (const id of ids) {
    await rawUpdate(id, cur => cur && { ...cur, owner: user.id, dirty: true, syncedAt: undefined })
    // ponytail: a failed upload (offline) is retried by the next sync, like any local edit.
    await pushToCloud(id)
  }
}

/** Signs in and unlocks the user's data key; `recoverySecret` comes from a reset link. */
export async function idbSignIn(
  email: string,
  password: string,
  recoverySecret?: string,
): Promise<void> {
  const { newKey } = await signIn(email, password, recoverySecret)
  if (newKey) {
    // Files on the server (if any) were encrypted with a key that no longer exists: re-upload
    // every local copy with the new one.
    for (const row of await rawGetAll()) {
      await rawUpdate(row.id, cur => cur && { ...cur, dirty: true })
    }
  }
  await resyncCloud()
}

/** Uploads pending edits, signs out, then removes local copies that are safely on the server. */
export async function idbSignOut(): Promise<void> {
  const pending = [...pushTimers.keys()]
  for (const id of pending) window.clearTimeout(pushTimers.get(id))
  pushTimers.clear()
  await Promise.all(pending.map(id => pushToCloud(id)))
  await signOut()
  for (const row of await rawGetAll()) {
    if (row.dirty === false) await rawDelete(row.id)
  }
}
