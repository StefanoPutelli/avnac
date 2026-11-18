import { describe, expect, it } from 'vitest'
import { cloudSyncAction } from '../lib/avnac-editor-idb'

describe('cloudSyncAction', () => {
  it('downloads files that exist only on the server', () => {
    expect(cloudSyncAction(undefined, 100)).toBe('download')
  })

  it('uploads account files never synced', () => {
    expect(cloudSyncAction({}, undefined)).toBe('push')
    expect(cloudSyncAction({ dirty: true }, undefined)).toBe('push')
  })

  it('deletes clean synced files that were removed on another device', () => {
    expect(cloudSyncAction({ dirty: false, syncedAt: 100 }, undefined)).toBe('delete-local')
  })

  it('keeps unsynced edits even if the server copy was deleted', () => {
    expect(cloudSyncAction({ dirty: true, syncedAt: 100 }, undefined)).toBe('push')
  })

  it('does nothing when both sides match', () => {
    expect(cloudSyncAction({ dirty: false, syncedAt: 100 }, 100)).toBe('none')
  })

  it('downloads newer server versions over clean local copies', () => {
    expect(cloudSyncAction({ dirty: false, syncedAt: 100 }, 200)).toBe('download')
  })

  it('pushes local edits, letting the server flag a conflict', () => {
    expect(cloudSyncAction({ dirty: true, syncedAt: 100 }, 100)).toBe('push')
    expect(cloudSyncAction({ dirty: true, syncedAt: 100 }, 200)).toBe('push')
  })
})
