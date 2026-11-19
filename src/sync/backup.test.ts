import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { addToCollection } from '../storage/collection'
import { createBook, createChapter, resetDatabaseForTests } from '../storage/db'
import { trashChapter } from '../storage/trash'
import { addImage, createEntry } from '../storage/wiki'
import { backupName, buildBackup, downloadBackup } from './backup'
import { saveSettings } from './settings'

beforeEach(async () => {
  await resetDatabaseForTests()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function seed() {
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Eins', 'Mira stood.')
  const gone = await createChapter(book.id, 'Zwei', 'weg')
  const entry = await createEntry(book.id, 'Pascal')
  const image = await addImage(entry.id, { type: 'image/webp', data: new Uint8Array([7, 8, 9, 255]).buffer, width: 2, height: 2 })
  await addToCollection({ text: 'a slow smile', category: 'Gestik' })
  const item = await trashChapter(gone.id)
  return { book, chapter, entry, image, item, p: `books/${book.id}/` }
}

test('names the file by date', () => {
  expect(backupName(new Date(2026, 10, 19, 23, 30))).toBe('Writer-Sicherung-2026-11-19.zip')
  expect(backupName(new Date(2027, 0, 5))).toBe('Writer-Sicherung-2027-01-05.zip')
})

test('the zip holds what the repository holds', async () => {
  const { p, chapter, entry, image, item } = await seed()
  const files = unzipSync(await buildBackup())
  expect(strFromU8(files[`${p}chapters/${chapter.id}.md`])).toBe('Mira stood.')
  expect(JSON.parse(strFromU8(files[`${p}book.json`])).title).toBe('Sturmlied')
  expect(strFromU8(files[`${p}wiki/${entry.id}.md`])).toContain('"name": "Pascal"')
  expect([...files[`${p}wiki/_images/${image.id}.webp`]]).toEqual([7, 8, 9, 255])
  expect(strFromU8(files['collection/collection.json'])).toContain('a slow smile')
  expect(strFromU8(files[`${p}trash/${item!.id}.json`])).toBe(item!.file)
})

test('the access token never goes into the zip', async () => {
  await seed()
  saveSettings({ owner: 'me', repo: 'books', token: 'github_pat_TEST1234' })
  const files = unzipSync(await buildBackup())
  for (const [path, data] of Object.entries(files)) {
    expect(path).not.toContain('github_pat')
    expect(strFromU8(data)).not.toContain('github_pat_TEST1234')
  }
})

test('downloadBackup hands the zip to the browser under its name', async () => {
  await seed()
  const created: Blob[] = []
  const createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob)
    return 'blob:backup'
  })
  const revokeObjectURL = vi.fn()
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  const clicked: HTMLAnchorElement[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this)
  })
  await downloadBackup(new Date(2026, 10, 19))
  expect(created[0].type).toBe('application/zip')
  expect(clicked[0].download).toBe('Writer-Sicherung-2026-11-19.zip')
  expect(clicked[0].href).toBe('blob:backup')
  expect(clicked[0].isConnected).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup')
})
