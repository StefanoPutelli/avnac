import { describe, expect, it } from 'vitest'
import { folderList, visibleFiles } from '../lib/avnac-files-view'

const items = [
  { name: 'File 10', updatedAt: 3, folder: null },
  { name: 'file 2', updatedAt: 1, folder: null },
  { name: 'Poster', updatedAt: 2, folder: 'Work' },
  { name: 'Logo', updatedAt: 4, folder: 'Work' },
]
const names = (list: { name: string }[]) => list.map(i => i.name)

describe('visibleFiles', () => {
  it('shows only the open folder', () => {
    const top = visibleFiles(items, { folder: null, query: '', sort: 'modified-desc' })
    expect(names(top)).toEqual(['File 10', 'file 2'])
    const work = visibleFiles(items, { folder: 'Work', query: '', sort: 'modified-desc' })
    expect(names(work)).toEqual(['Logo', 'Poster'])
  })

  it('searches every folder, ignoring case', () => {
    expect(names(visibleFiles(items, { folder: null, query: ' POS ', sort: 'name-asc' }))).toEqual([
      'Poster',
    ])
    expect(names(visibleFiles(items, { folder: 'Work', query: 'file', sort: 'name-asc' }))).toEqual(
      ['file 2', 'File 10'],
    )
  })

  it('sorts by date and by name, numbers in natural order', () => {
    const sorted = (sort: Parameters<typeof visibleFiles>[1]['sort']) =>
      names(visibleFiles(items, { folder: null, query: 'o', sort }))
    expect(sorted('modified-desc')).toEqual(['Logo', 'Poster'])
    expect(sorted('modified-asc')).toEqual(['Poster', 'Logo'])
    const all = (sort: Parameters<typeof visibleFiles>[1]['sort']) =>
      names(visibleFiles(items, { folder: null, query: 'file', sort }))
    expect(all('name-asc')).toEqual(['file 2', 'File 10'])
    expect(all('name-desc')).toEqual(['File 10', 'file 2'])
  })
})

describe('folderList', () => {
  it('merges folders from files with empty ones kept in this browser', () => {
    expect(folderList(items, ['Archive', 'Work'])).toEqual([
      { name: 'Archive', count: 0 },
      { name: 'Work', count: 2 },
    ])
  })
})
