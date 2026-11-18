import type { VectorBoardDocument } from './avnac-vector-board-document'
import { emptyVectorBoardDocument, migrateVectorBoardDocument } from './avnac-vector-board-document'

export type AvnacVectorBoardMeta = {
  id: string
  name: string
  createdAt: number
}

const keyFor = (persistId: string) => `avnac-vector-boards:${persistId}`
const docsKeyFor = (persistId: string) => `avnac-vector-board-docs:${persistId}`

export function loadVectorBoards(persistId: string): AvnacVectorBoardMeta[] {
  try {
    const raw = localStorage.getItem(keyFor(persistId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(row => {
        if (!row || typeof row !== 'object') return null
        const o = row as Record<string, unknown>
        const id = typeof o.id === 'string' ? o.id : null
        const name = typeof o.name === 'string' ? o.name : null
        const createdAt = typeof o.createdAt === 'number' ? o.createdAt : null
        if (!id || !name || createdAt == null) return null
        return { id, name, createdAt } satisfies AvnacVectorBoardMeta
      })
      .filter((x): x is AvnacVectorBoardMeta => x != null)
  } catch {
    return []
  }
}

/** Returns true if the stored value changed (a missing key counts as `empty`). */
function setIfChanged(key: string, value: string, empty: string): boolean {
  try {
    if ((localStorage.getItem(key) ?? empty) === value) return false
    localStorage.setItem(key, value)
    return true
  } catch {
    /* ignore quota / private mode */
    return false
  }
}

export function saveVectorBoards(persistId: string, boards: AvnacVectorBoardMeta[]): boolean {
  return setIfChanged(keyFor(persistId), JSON.stringify(boards), '[]')
}

export function loadVectorBoardDocs(persistId: string): Record<string, VectorBoardDocument> {
  try {
    const raw = localStorage.getItem(docsKeyFor(persistId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, VectorBoardDocument> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v !== 'object') continue
      out[k] = migrateVectorBoardDocument(v)
    }
    return out
  } catch {
    return {}
  }
}

export function saveVectorBoardDocs(
  persistId: string,
  docs: Record<string, VectorBoardDocument>,
): boolean {
  return setIfChanged(docsKeyFor(persistId), JSON.stringify(docs), '{}')
}

export function mergeVectorBoardDocsForMeta(
  boards: AvnacVectorBoardMeta[],
  existing: Record<string, VectorBoardDocument>,
): Record<string, VectorBoardDocument> {
  const next = { ...existing }
  for (const b of boards) {
    if (!next[b.id]) next[b.id] = emptyVectorBoardDocument()
  }
  return next
}

export function clearAvnacVectorBoardStorage(persistId: string): void {
  try {
    localStorage.removeItem(keyFor(persistId))
    localStorage.removeItem(docsKeyFor(persistId))
  } catch {
    /* ignore */
  }
}
