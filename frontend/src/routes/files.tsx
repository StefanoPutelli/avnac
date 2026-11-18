import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  CloudUploadIcon,
  Folder01Icon,
  FolderAddIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { createFileRoute } from '@tanstack/react-router'
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AccountMenu from '../components/account-menu'
import DeleteConfirmDialog from '../components/delete-confirm-dialog'
import DocumentMigrationDialog from '../components/document-migration-dialog'
import FileGridCard from '../components/file-grid-card'
import { MoveToFolderDialog, NewFolderDialog } from '../components/files-folder-dialogs'
import FilesMultiselectBar from '../components/files-multiselect-bar'
import { inputClass, secondaryButtonClass } from '../components/form-dialog'
import NewCanvasDialog from '../components/new-canvas-dialog'
import { parseAvnacDocument } from '../lib/avnac-document'
import { avnacDocumentPreviewEvictPersistId } from '../lib/avnac-document-preview'
import {
  type AvnacEditorIdbListItem,
  idbDeleteDocument,
  idbListDocuments,
  idbMigrateLegacyDocument,
  idbMoveDocuments,
  idbPutDocument,
  idbUploadLocalDocuments,
  resyncCloud,
} from '../lib/avnac-editor-idb'
import { downloadAvnacJsonForId } from '../lib/avnac-files-export'
import {
  FILE_DRAG_TYPE,
  FILES_SORT_LABELS,
  type FilesSort,
  folderList,
  loadSort,
  loadStoredFolders,
  saveSort,
  saveStoredFolders,
  visibleFiles,
} from '../lib/avnac-files-view'

type FilesSearch = { folder?: string }

export const Route = createFileRoute('/files')({
  validateSearch: (raw: Record<string, unknown>): FilesSearch => ({
    folder: typeof raw.folder === 'string' && raw.folder ? raw.folder : undefined,
  }),
  component: FilesPage,
})

function formatUpdatedAt(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ts))
  } catch {
    return new Date(ts).toLocaleString()
  }
}

function nameFromImportFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').trim()
  return base || 'Imported file'
}

function FilesPage() {
  const [items, setItems] = useState<AvnacEditorIdbListItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [newCanvasOpen, setNewCanvasOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleteDialog, setDeleteDialog] = useState<{
    ids: string[]
    title: string
    message: string
    /** Deleting a folder: also forget the folder itself. */
    folder?: string
  } | null>(null)
  const [migrationDialog, setMigrationDialog] = useState<{
    ids: string[]
    title: string
    message: string
    confirmLabel: string
    openFileId?: string
  } | null>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<FilesSort>(loadSort)
  const [storedFolders, setStoredFolders] = useState(loadStoredFolders)
  const [moveIds, setMoveIds] = useState<string[]>([])
  /** Drop target under the pointer while dragging a file: a folder name, or '' for the top level. */
  const [dragOver, setDragOver] = useState<string | null>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const newFolderRef = useRef<HTMLDialogElement>(null)
  const moveRef = useRef<HTMLDialogElement>(null)
  const navigate = Route.useNavigate()
  const folder = Route.useSearch().folder ?? null
  const searching = query.trim() !== ''
  const shown = useMemo(
    () => (items ? visibleFiles(items, { folder, query, sort }) : []),
    [items, folder, query, sort],
  )
  const folders = useMemo(() => folderList(items ?? [], storedFolders), [items, storedFolders])

  const clearSelection = useCallback(() => setSelectedIds([]), [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }, [])

  const refreshList = useCallback(() => {
    void idbListDocuments()
      .then(list => {
        setItems(list)
        setLoadError(null)
      })
      .catch(() => {
        setLoadError('Could not load files.')
        setItems([])
      })
  }, [])

  useEffect(() => {
    void resyncCloud()
    refreshList()
  }, [refreshList])

  useEffect(() => {
    const valid = new Set(shown.map(i => i.id))
    setSelectedIds(prev => {
      const next = prev.filter(id => valid.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [shown])

  useEffect(() => {
    if (!actionsOpen) return
    const onDoc = (e: MouseEvent) => {
      const el = actionsRef.current
      if (el && !el.contains(e.target as Node)) setActionsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActionsOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [actionsOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (deleteDialog) {
        e.preventDefault()
        setDeleteDialog(null)
        return
      }
      if (selectedIds.length > 0) clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteDialog, selectedIds.length, clearSelection])

  const bulkDownload = useCallback(() => {
    const ids = [...selectedIds]
    void (async () => {
      try {
        for (const id of ids) {
          await downloadAvnacJsonForId(id)
          await new Promise(r => setTimeout(r, 140))
        }
      } catch (err) {
        console.error('[avnac] bulk download failed', err)
      }
    })()
  }, [selectedIds])

  const bulkTrash = useCallback(() => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    const n = ids.length
    setDeleteDialog({
      ids,
      title: n === 1 ? 'Remove this file?' : 'Remove these files?',
      message:
        n === 1
          ? 'This will permanently remove the file from this browser. This cannot be undone.'
          : `This will permanently remove ${n} files from this browser. This cannot be undone.`,
    })
  }, [selectedIds])

  const rememberFolder = useCallback((name: string) => {
    setStoredFolders(prev => {
      if (prev.includes(name)) return prev
      const next = [...prev, name]
      saveStoredFolders(next)
      return next
    })
  }, [])

  // Folders exist through their files; the stored list only keeps empty ones. So a folder deleted
  // on another device disappears here too, while one emptied on this page stays.
  useEffect(() => {
    if (!items) return
    const used = new Set(items.map(i => i.folder))
    setStoredFolders(prev => {
      const next = prev.filter(name => !used.has(name))
      if (next.length === prev.length) return prev
      saveStoredFolders(next)
      return next
    })
  }, [items])

  const keepEmptiedFolders = useCallback(
    (ids: string[]) => {
      const list = items ?? []
      for (const row of list) {
        const name = row.folder
        if (!name || !ids.includes(row.id)) continue
        if (list.every(i => i.folder !== name || ids.includes(i.id))) rememberFolder(name)
      }
    },
    [items, rememberFolder],
  )

  const forgetFolder = useCallback((name: string) => {
    setStoredFolders(prev => {
      const next = prev.filter(n => n !== name)
      saveStoredFolders(next)
      return next
    })
  }, [])

  const openFolder = useCallback(
    (name: string | null) => {
      setSelectedIds([])
      void navigate({ search: name ? { folder: name } : {} })
    },
    [navigate],
  )

  const moveFiles = useCallback(
    async (ids: string[], target: string | null) => {
      keepEmptiedFolders(ids)
      if (target) rememberFolder(target)
      try {
        await idbMoveDocuments(ids, target)
      } catch (err) {
        console.error('[avnac] move failed', err)
        setImportError('Those files could not be moved right now. Try again in a moment.')
      }
      setSelectedIds([])
      refreshList()
    },
    [keepEmptiedFolders, refreshList, rememberFolder],
  )

  const requestMove = useCallback((ids: string[]) => {
    setMoveIds(ids)
    moveRef.current?.showModal()
  }, [])

  /** Drop a card here; a card that is part of the selection moves the whole selection. */
  const dropTarget = (target: string | null) => {
    const key = target ?? ''
    return {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(FILE_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDragOver(key)
      },
      onDragLeave: () => setDragOver(cur => (cur === key ? null : cur)),
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setDragOver(null)
        const id = e.dataTransfer.getData(FILE_DRAG_TYPE)
        if (id) void moveFiles(selectedIds.includes(id) ? selectedIds : [id], target)
      },
    }
  }

  const requestDeleteFolder = useCallback(() => {
    if (!folder) return
    const ids = (items ?? []).filter(row => row.folder === folder).map(row => row.id)
    setDeleteDialog({
      ids,
      folder,
      title: 'Delete this folder?',
      message:
        ids.length === 0
          ? `This removes the empty folder "${folder}".`
          : `This permanently removes the folder "${folder}" and the ${ids.length === 1 ? 'file' : `${ids.length} files`} in it. This cannot be undone.`,
    })
  }, [folder, items])

  const confirmDelete = useCallback(() => {
    if (!deleteDialog) return
    const ids = [...deleteDialog.ids]
    if (deleteDialog.folder === undefined) keepEmptiedFolders(ids)
    setDeleteDialog(null)
    void (async () => {
      try {
        for (const id of ids) {
          await idbDeleteDocument(id)
          avnacDocumentPreviewEvictPersistId(id)
        }
        setSelectedIds(prev => prev.filter(id => !ids.includes(id)))
        if (deleteDialog.folder !== undefined) {
          forgetFolder(deleteDialog.folder)
          void navigate({ search: {} })
        }
        refreshList()
      } catch (err) {
        console.error('[avnac] delete failed', err)
      }
    })()
  }, [deleteDialog, forgetFolder, keepEmptiedFolders, navigate, refreshList])

  const requestDeleteFile = useCallback((id: string) => {
    setDeleteDialog({
      ids: [id],
      title: 'Remove this file?',
      message: 'This will permanently remove the file from this browser. This cannot be undone.',
    })
  }, [])

  const importFromJsonFile = useCallback(
    async (file: File) => {
      setImportError(null)
      setActionsOpen(false)
      try {
        let raw: unknown
        try {
          raw = JSON.parse(await file.text()) as unknown
        } catch (err) {
          console.error(err)
          setImportError(
            'That file is not valid JSON. Choose an exported Avnac JSON document and try again.',
          )
          return
        }
        const document = parseAvnacDocument(raw)
        if (!document) {
          setImportError(
            'This JSON file could not be imported. Try an Avnac export or a legacy Fabric-based Avnac file.',
          )
          return
        }
        const id = crypto.randomUUID()
        const name = nameFromImportFilename(file.name)
        await idbPutDocument(id, document, { name, folder: folder ?? undefined })
        refreshList()
        void navigate({ to: '/create', search: { id } })
      } catch (err) {
        console.error(err)
        setImportError(
          'The file could not be imported into this browser right now. Try again in a moment.',
        )
      }
    },
    [folder, navigate, refreshList],
  )

  const onImportInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      void importFromJsonFile(file)
    },
    [importFromJsonFile],
  )

  const selectionCount = selectedIds.length
  const legacyItems = items?.filter(row => row.isLegacy) ?? []
  const legacyCount = legacyItems.length
  const localCount = items?.filter(row => row.local).length ?? 0
  const actionButtonClass =
    'inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center border-0 bg-[var(--text)] text-[15px] font-medium text-white transition hover:bg-[#262626] sm:min-h-12 sm:text-[1.0625rem]'
  const menuItemClass =
    'flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[14px] font-medium text-[var(--text)] transition-colors hover:bg-black/[0.04]'

  const requestOpenFile = useCallback(
    (row: AvnacEditorIdbListItem) => {
      if (row.isLegacy) {
        setMigrationDialog({
          ids: [row.id],
          title: 'Convert this file first',
          message: `"${row.name}" was made in an older version of Avnac. Convert it to the new editor before opening it.`,
          confirmLabel: 'Convert and open',
          openFileId: row.id,
        })
        return
      }
      void navigate({ to: '/create', search: { id: row.id } })
    },
    [navigate],
  )

  const requestMigrateAll = useCallback(() => {
    if (legacyItems.length === 0) return
    setMigrationDialog({
      ids: legacyItems.map(row => row.id),
      title:
        legacyItems.length === 1
          ? 'Migrate 1 old file?'
          : `Migrate ${legacyItems.length} old files?`,
      message:
        legacyItems.length === 1
          ? 'This file was saved in an older version of Avnac. Convert it now so it opens normally in the new editor.'
          : 'These files were saved in an older version of Avnac. Convert them now so they open normally in the new editor.',
      confirmLabel: legacyItems.length === 1 ? 'Convert file' : 'Migrate all files',
    })
  }, [legacyItems])

  const confirmMigration = useCallback(() => {
    if (!migrationDialog || migrationBusy) return
    const { ids, openFileId } = migrationDialog
    setMigrationBusy(true)
    void (async () => {
      try {
        for (const id of ids) {
          await idbMigrateLegacyDocument(id)
        }
        setMigrationDialog(null)
        refreshList()
        if (openFileId) {
          void navigate({ to: '/create', search: { id: openFileId } })
        }
      } catch (err) {
        console.error(err)
        setImportError('Those files could not be converted right now. Try again in a moment.')
      } finally {
        setMigrationBusy(false)
      }
    })()
  }, [migrationBusy, migrationDialog, navigate, refreshList])

  const uploadLocalFiles = useCallback(() => {
    if (uploadBusy || !items) return
    setUploadBusy(true)
    setImportError(null)
    void idbUploadLocalDocuments(items.filter(row => row.local).map(row => row.id))
      .catch(err => {
        console.error(err)
        setImportError('Those files could not be uploaded right now. Try again in a moment.')
      })
      .finally(() => {
        setUploadBusy(false)
        refreshList()
      })
  }, [items, refreshList, uploadBusy])

  return (
    <main className="hero-page relative flex min-h-[100dvh] flex-col overflow-hidden">
      <div className="hero-bg-orb hero-bg-orb-a" aria-hidden="true" />
      <div className="hero-bg-orb hero-bg-orb-b" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />

      <div className="relative z-[1] flex flex-1 flex-col">
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] pt-4 sm:pt-5">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-3 px-5 sm:px-8 pointer-events-auto">
            <AccountMenu onChange={refreshList} />
            <div ref={actionsRef} className="relative flex shrink-0">
              <button
                type="button"
                className={`${actionButtonClass} rounded-l-full px-6 py-2.5 sm:px-8 sm:py-3`}
                onClick={() => setNewCanvasOpen(true)}
              >
                New file
              </button>
              <button
                type="button"
                aria-label="More file actions"
                aria-expanded={actionsOpen}
                aria-haspopup="menu"
                className={`${actionButtonClass} rounded-r-full border-l border-white/18 px-4 py-2.5 sm:px-5 sm:py-3`}
                onClick={() => setActionsOpen(open => !open)}
              >
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={18}
                  strokeWidth={1.85}
                  className="shrink-0"
                />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={onImportInputChange}
              />
              {actionsOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 min-w-[14rem] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.12)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItemClass}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <HugeiconsIcon
                      icon={CloudUploadIcon}
                      size={18}
                      strokeWidth={1.7}
                      className="shrink-0 text-[var(--text-muted)]"
                    />
                    Import JSON
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="shrink-0 pt-4 sm:pt-5" aria-hidden>
          <div className="mx-auto flex h-11 w-full max-w-6xl justify-end px-5 sm:h-12 sm:px-8" />
        </div>

        <div
          className={`mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8 sm:py-16 lg:py-20 ${selectionCount > 0 ? 'pb-28 sm:pb-32' : ''}`}
        >
          <div className="rise-in">
            {folder ? (
              <button
                type="button"
                {...dropTarget(null)}
                className={`mb-3 inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 -ml-3 text-[15px] font-medium text-[var(--text-muted)] transition-colors hover:bg-black/[0.04] hover:text-[var(--text)] ${dragOver === '' ? 'bg-black/[0.06] text-[var(--text)] ring-2 ring-[var(--text)]' : 'bg-transparent'}`}
                onClick={() => openFolder(null)}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.9} />
                All files
              </button>
            ) : null}
            <h1 className="display-title mb-4 break-words text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--text)]">
              {folder ?? 'Files'}
            </h1>
            <p className="mb-12 max-w-xl text-lg leading-[1.6] text-[var(--text-muted)] sm:text-xl sm:leading-[1.55]">
              {folder
                ? 'Drag files onto "All files" to take them out of this folder.'
                : 'Designs saved in this browser. Open one to keep editing.'}
            </p>

            {loadError ? (
              <p className="text-base leading-relaxed text-red-600">{loadError}</p>
            ) : null}

            {importError ? (
              <p className="mt-4 text-base leading-relaxed text-red-600">{importError}</p>
            ) : null}

            {legacyCount > 0 ? (
              <div className="mb-8 flex flex-col gap-4 rounded-[1.75rem] border border-amber-300/60 bg-[linear-gradient(135deg,rgba(255,247,214,0.9),rgba(255,236,179,0.7))] p-5 shadow-[0_18px_44px_rgba(190,130,24,0.12)] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900/70">
                    Old Files Found
                  </div>
                  <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-amber-950/80 sm:text-base">
                    {legacyCount === 1
                      ? 'There is 1 file from the older editor in this browser. Convert it once and it will open normally in the new canvas.'
                      : `There are ${legacyCount} files from the older editor in this browser. Convert them once and they will open normally in the new canvas.`}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border-0 bg-[var(--text)] px-6 py-2.5 text-[15px] font-medium text-white transition hover:bg-[#262626] sm:min-h-12"
                  onClick={requestMigrateAll}
                >
                  {legacyCount === 1 ? 'Migrate old file' : 'Migrate all old files'}
                </button>
              </div>
            ) : null}

            {localCount > 0 ? (
              <div className="mb-8 flex flex-col gap-4 rounded-[1.75rem] border border-[var(--line)] bg-white/60 p-5 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Only in this browser
                  </div>
                  <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--text-muted)] sm:text-base">
                    {localCount === 1
                      ? "1 file marked Local was made while signed out, so it isn't in your account yet. Upload it from its card or here."
                      : `${localCount} files marked Local were made while signed out, so they aren't in your account yet. Upload them one by one from each card, or all at once.`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={uploadBusy}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border-0 bg-[var(--text)] px-6 py-2.5 text-[15px] font-medium text-white transition hover:bg-[#262626] disabled:opacity-60 sm:min-h-12"
                  onClick={uploadLocalFiles}
                >
                  {uploadBusy ? 'Uploading…' : 'Upload to my account'}
                </button>
              </div>
            ) : null}

            {items === null ? (
              <p className="text-lg text-[var(--text-muted)]">Loading…</p>
            ) : items.length === 0 && folders.length === 0 && !folder ? (
              <div className="max-w-xl">
                <p className="m-0 text-lg leading-[1.6] text-[var(--text-muted)]">
                  Nothing here yet. Start a canvas — it autosaves as you work.
                </p>
                <button
                  type="button"
                  className="mt-8 inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full border-0 bg-[var(--text)] px-10 py-3.5 text-base font-medium text-white hover:bg-[#262626] sm:min-h-14 sm:px-12 sm:py-4 sm:text-[1.0625rem]"
                  onClick={() => setNewCanvasOpen(true)}
                >
                  Open editor
                </button>
              </div>
            ) : (
              <>
                <div className="mb-8 flex flex-wrap items-center gap-3">
                  <label className="relative min-w-[14rem] flex-1">
                    <HugeiconsIcon
                      icon={Search01Icon}
                      size={18}
                      strokeWidth={1.8}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                    />
                    <input
                      type="search"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      aria-label="Search files"
                      placeholder="Search all files"
                      className={`${inputClass} min-h-11 pl-10 sm:min-h-12`}
                    />
                  </label>
                  <div className="w-full sm:w-48">
                    <select
                      value={sort}
                      aria-label="Sort files"
                      onChange={e => {
                        const next = e.target.value as FilesSort
                        setSort(next)
                        saveSort(next)
                      }}
                      className={`${inputClass} min-h-11 cursor-pointer sm:min-h-12`}
                    >
                      {Object.entries(FILES_SORT_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {folder ? (
                    <button
                      type="button"
                      className={`${secondaryButtonClass} text-red-600 hover:bg-red-50`}
                      onClick={requestDeleteFolder}
                    >
                      Delete folder
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${secondaryButtonClass} gap-2`}
                      onClick={() => newFolderRef.current?.showModal()}
                    >
                      <HugeiconsIcon icon={FolderAddIcon} size={18} strokeWidth={1.7} />
                      New folder
                    </button>
                  )}
                </div>

                {!folder && !searching && folders.length > 0 ? (
                  <ul className="m-0 mb-8 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-3 lg:grid-cols-4">
                    {folders.map(f => (
                      <li key={f.name} className="min-w-0">
                        <button
                          type="button"
                          {...dropTarget(f.name)}
                          onClick={() => openFolder(f.name)}
                          className={`flex w-full min-w-0 items-center gap-3 rounded-2xl border px-4 py-3.5 text-left backdrop-blur-md transition-[border-color,background-color] duration-150 hover:border-black/[0.14] hover:bg-white/72 ${dragOver === f.name ? 'border-[var(--text)] bg-white ring-2 ring-[var(--text)]' : 'border-[var(--line)] bg-white/50'}`}
                        >
                          <HugeiconsIcon
                            icon={Folder01Icon}
                            size={22}
                            strokeWidth={1.6}
                            className="shrink-0 text-[var(--text-muted)]"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[15px] font-medium text-[var(--text)]">
                              {f.name}
                            </span>
                            <span className="block text-[12px] tabular-nums text-[var(--text-muted)]">
                              {f.count === 1 ? '1 file' : `${f.count} files`}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {shown.length === 0 ? (
                  <p className="m-0 text-lg leading-[1.6] text-[var(--text-muted)]">
                    {searching
                      ? `No files match "${query.trim()}".`
                      : folder
                        ? 'This folder is empty. Drag files here from "All files", or use Move to folder.'
                        : 'No files outside folders.'}
                  </p>
                ) : (
                  <ul className="m-0 grid list-none grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 sm:gap-7">
                    {shown.map(row => (
                      <FileGridCard
                        key={row.id}
                        row={row}
                        formatUpdatedAt={formatUpdatedAt}
                        onListChange={refreshList}
                        selected={selectedIds.includes(row.id)}
                        onToggleSelect={toggleSelect}
                        onRequestDelete={requestDeleteFile}
                        onRequestOpen={requestOpenFile}
                        onRequestMove={id => requestMove([id])}
                        showFolder={searching}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <NewCanvasDialog
        open={newCanvasOpen}
        onClose={() => setNewCanvasOpen(false)}
        folder={folder ?? undefined}
      />
      <FilesMultiselectBar
        count={selectionCount}
        onClear={clearSelection}
        onDownload={bulkDownload}
        onMove={() => requestMove(selectedIds)}
        onTrash={bulkTrash}
      />
      <NewFolderDialog
        dialogRef={newFolderRef}
        onCreate={name => {
          rememberFolder(name)
          openFolder(name)
        }}
      />
      <MoveToFolderDialog
        dialogRef={moveRef}
        count={moveIds.length}
        folders={folders.map(f => f.name)}
        onMove={target => void moveFiles(moveIds, target)}
      />
      <DeleteConfirmDialog
        open={deleteDialog !== null}
        title={deleteDialog?.title ?? ''}
        message={deleteDialog?.message ?? ''}
        confirmLabel={deleteDialog?.folder !== undefined ? 'Delete folder' : undefined}
        onClose={() => setDeleteDialog(null)}
        onConfirm={confirmDelete}
      />
      <DocumentMigrationDialog
        open={migrationDialog !== null}
        title={migrationDialog?.title ?? ''}
        message={migrationDialog?.message ?? ''}
        confirmLabel={migrationDialog?.confirmLabel ?? 'Convert file'}
        busy={migrationBusy}
        onClose={() => {
          if (migrationBusy) return
          if (migrationDialog) {
          }
          setMigrationDialog(null)
        }}
        onConfirm={confirmMigration}
      />
    </main>
  )
}
