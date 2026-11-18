import type { AvnacEditorIdbListItem } from './avnac-editor-idb'

/** Drag & drop payload: the dragged file's id. */
export const FILE_DRAG_TYPE = 'application/x-avnac-file'

export type FilesSort = 'modified-desc' | 'modified-asc' | 'name-asc' | 'name-desc'

export const FILES_SORT_LABELS: Record<FilesSort, string> = {
  'modified-desc': 'Last modified',
  'modified-asc': 'Oldest first',
  'name-asc': 'Name A–Z',
  'name-desc': 'Name Z–A',
}

type ViewItem = Pick<AvnacEditorIdbListItem, 'name' | 'updatedAt' | 'folder'>

const byName = (a: ViewItem, b: ViewItem) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

/** A search looks in every folder; otherwise only the open folder (null = top level). */
export function visibleFiles<T extends ViewItem>(
  items: T[],
  { folder, query, sort }: { folder: string | null; query: string; sort: FilesSort },
): T[] {
  const q = query.trim().toLowerCase()
  const shown = q
    ? items.filter(item => item.name.toLowerCase().includes(q))
    : items.filter(item => item.folder === folder)
  const compare: Record<FilesSort, (a: T, b: T) => number> = {
    'modified-desc': (a, b) => b.updatedAt - a.updatedAt,
    'modified-asc': (a, b) => a.updatedAt - b.updatedAt,
    'name-asc': byName,
    'name-desc': (a, b) => byName(b, a),
  }
  return [...shown].sort(compare[sort])
}

/** Folders used by files plus the empty ones created in this browser, A–Z, with file counts. */
export function folderList(items: ViewItem[], stored: string[]): { name: string; count: number }[] {
  const counts = new Map(stored.map(name => [name, 0]))
  for (const item of items) {
    if (item.folder) counts.set(item.folder, (counts.get(item.folder) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

// ponytail: empty folders live only in this browser; a folder shows up on other devices once
// it holds a file (the folder name travels inside each encrypted file). Sync them as their own
// records if empty folders must follow the account.
const FOLDERS_KEY = 'avnac-folders'
const SORT_KEY = 'avnac-files-sort'

export function loadStoredFolders(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function saveStoredFolders(names: string[]): void {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(names))
  } catch {}
}

export function loadSort(): FilesSort {
  try {
    const value = localStorage.getItem(SORT_KEY)
    if (value && value in FILES_SORT_LABELS) return value as FilesSort
  } catch {}
  return 'modified-desc'
}

export function saveSort(sort: FilesSort): void {
  try {
    localStorage.setItem(SORT_KEY, sort)
  } catch {}
}
