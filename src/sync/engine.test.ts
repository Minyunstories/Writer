import { deleteDB } from 'idb'
import { beforeEach, expect, test } from 'vitest'
import { useDatabaseForTests } from '../storage/connection'
import { createBook, createChapter, deleteBook, deleteChapter, getChapter, listBooks, listChapters, updateBook, updateChapter } from '../storage/db'
import { addImage, createEntry, createFolder, getImage, listEntries, listFolders, setFolderTemplate, updateEntry } from '../storage/wiki'
import { runSync } from './engine'
import { createFakeGitHub } from './fakeGitHub'
import { GitHubError } from './github'
import { loadSyncState, readLocalFiles } from './local'
import type { RemoteApi } from './github'

const A = 'device-a'
const B = 'device-b'
const on = (device: string) => useDatabaseForTests(device)
let repo: ReturnType<typeof createFakeGitHub>

async function sync(device: string, confirmBookDeletion: (titles: string[]) => Promise<boolean> = async () => true) {
  await on(device)
  return runSync(repo, { confirmBookDeletion })
}

const chaptersOf = async (device: string) => {
  await on(device)
  const [book] = await listBooks()
  return book ? (await listChapters(book.id)).map((c) => [c.title, c.content]) : []
}

async function seedA() {
  await on(A)
  const book = await createBook('Sturmlied')
  const one = await createChapter(book.id, 'Anfang', 'eins')
  const two = await createChapter(book.id, 'Sturm', 'zwei')
  return { book, one, two }
}

beforeEach(async () => {
  await on('minyunwriter')
  await deleteDB(A)
  await deleteDB(B)
  repo = createFakeGitHub()
})

test('first sync fills an empty repository; a second run changes nothing', async () => {
  const { book, one } = await seedA()
  expect(await sync(A)).toMatchObject({ pushed: 3, pulled: 0, conflicts: [], head: (await repo.getHead())?.commit })
  expect((await repo.files()).get(`books/${book.id}/chapters/${one.id}.md`)).toBe('eins')
  expect(repo.commits).toBe(1)
  expect(await sync(A)).toMatchObject({ pushed: 0, pulled: 0, conflicts: [] })
  expect(repo.commits).toBe(1)
})

test('a second device without data receives everything, images included', async () => {
  const { book } = await seedA()
  const entry = await createEntry(book.id, 'Pascal')
  const image = await addImage(entry.id, { type: 'image/webp', data: new Uint8Array([9, 0, 255, 13]).buffer, width: 2, height: 2 })
  await sync(A)
  const result = await sync(B)
  // book.json, two chapters, the entry, its image and the wiki order.
  expect(result.pulled).toBe(6)
  expect(result.pushed).toBe(0)
  expect(await chaptersOf(B)).toEqual([['Anfang', 'eins'], ['Sturm', 'zwei']])
  expect((await listEntries(book.id))[0]).toMatchObject({ name: 'Pascal', imageIds: [image.id] })
  expect([...new Uint8Array((await getImage(image.id))!.data)]).toEqual([9, 0, 255, 13])
  expect(repo.commits).toBe(1)
})

test('edits travel both ways and different chapters merge without conflict', async () => {
  const { one, two } = await seedA()
  await sync(A)
  await sync(B)
  await on(A)
  await updateChapter(one.id, { content: 'eins von A' })
  await on(B)
  await updateChapter(two.id, { content: 'zwei von B', outline: 'Notiz von B' })
  expect((await sync(A)).conflicts).toEqual([])
  expect((await sync(B)).conflicts).toEqual([])
  await sync(A)
  for (const device of [A, B]) {
    expect(await chaptersOf(device)).toEqual([['Anfang', 'eins von A'], ['Sturm', 'zwei von B']])
  }
  await on(A)
  expect((await getChapter(two.id))!.outline).toBe('Notiz von B')
  const commits = repo.commits
  await sync(A)
  await sync(B)
  expect(repo.commits).toBe(commits)
})

test('the same chapter edited on both devices: both versions survive everywhere', async () => {
  const { one } = await seedA()
  await sync(A)
  await sync(B)
  await on(A)
  await updateChapter(one.id, { content: 'Fassung A' })
  await on(B)
  await updateChapter(one.id, { content: 'Fassung B' })
  await sync(A)
  const result = await sync(B)
  expect(result.conflicts).toEqual([{ bookTitle: 'Sturmlied', kind: 'chapter', name: 'Anfang' }])
  await sync(A)
  const expected = [['Anfang', 'Fassung A'], ['Anfang (Fassung von diesem Gerät)', 'Fassung B'], ['Sturm', 'zwei']]
  expect(await chaptersOf(B)).toEqual(expected)
  expect(await chaptersOf(A)).toEqual(expected)
  const commits = repo.commits
  await sync(B)
  await sync(A)
  expect(repo.commits).toBe(commits)
})

test('renames, reordering and deletions propagate', async () => {
  const { book, one, two } = await seedA()
  await sync(A)
  await sync(B)
  await on(A)
  await updateChapter(one.id, { title: 'Prolog' })
  await updateBook(book.id, { chapterOrder: [two.id, one.id], title: 'Sturmlied II' })
  await sync(A)
  await sync(B)
  expect(await chaptersOf(B)).toEqual([['Sturm', 'zwei'], ['Prolog', 'eins']])
  expect((await listBooks())[0].title).toBe('Sturmlied II')
  await deleteChapter(two.id)
  await sync(B)
  await sync(A)
  expect(await chaptersOf(A)).toEqual([['Prolog', 'eins']])
  await deleteBook(book.id)
  await sync(A)
  await sync(B)
  expect(await listBooks()).toEqual([])
  expect([...(await repo.files()).keys()]).toEqual([])
})

test('a book deleted on one device but edited on the other comes back whole', async () => {
  const { book, one } = await seedA()
  await sync(A)
  await sync(B)
  await on(A)
  await deleteBook(book.id)
  await on(B)
  await updateChapter(one.id, { content: 'noch gebraucht' })
  await sync(A)
  await sync(B)
  await sync(A)
  expect(await chaptersOf(A)).toEqual([['Anfang', 'noch gebraucht'], ['Sturm', 'zwei']])
  expect(await chaptersOf(B)).toEqual([['Anfang', 'noch gebraucht'], ['Sturm', 'zwei']])
})

test('wiki entries sync and conflict by keeping both', async () => {
  const { book } = await seedA()
  const entry = await createEntry(book.id, 'Pascal')
  await sync(A)
  await sync(B)
  await on(A)
  await updateEntry(entry.id, { body: 'von A' })
  await on(B)
  await updateEntry(entry.id, { body: 'von B' })
  await sync(A)
  expect((await sync(B)).conflicts).toEqual([{ bookTitle: 'Sturmlied', kind: 'entry', name: 'Pascal' }])
  await sync(A)
  await on(A)
  expect((await listEntries(book.id)).map((e) => [e.name, e.body])).toEqual([
    ['Pascal', 'von A'],
    ['Pascal (Fassung von diesem Gerät)', 'von B'],
  ])
})

test('a run interrupted before the commit converges on the next run', async () => {
  const { one } = await seedA()
  await sync(A)
  await on(A)
  await updateChapter(one.id, { content: 'neu' })
  repo.failNext('offline', 2) // head and tree succeed; the commit fails
  await expect(sync(A)).rejects.toBeInstanceOf(GitHubError)
  expect(repo.commits).toBe(1)
  expect((await sync(A)).pushed).toBe(1)
  expect(repo.commits).toBe(2)
  await sync(B)
  expect((await chaptersOf(B))[0]).toEqual(['Anfang', 'neu'])
})

test('a run interrupted after the commit does not commit twice', async () => {
  const { one } = await seedA()
  await sync(A)
  await on(A)
  await updateChapter(one.id, { content: 'neu' })
  const files = await readLocalFiles()
  // Play the commit by hand, as if the app died before it could store the new state.
  const sha = await repo.createBlob('neu')
  const head = (await repo.getHead())!
  await repo.commit({ parent: head.commit, baseTree: head.tree, write: new Map([[[...files.keys()].find((p) => p.endsWith(`${one.id}.md`))!, sha]]), remove: [], inline: new Map(), message: 'm' })
  const commits = repo.commits
  expect(await sync(A)).toMatchObject({ pushed: 0, pulled: 0, conflicts: [] })
  expect(repo.commits).toBe(commits)
  expect((await loadSyncState(repo.id))!.base.size).toBe(files.size)
})

test('a branch that moved during the run restarts the run', async () => {
  const { one, two } = await seedA()
  await sync(A)
  await sync(B)
  await on(B)
  await updateChapter(two.id, { content: 'zwei von B' })
  await on(A)
  await updateChapter(one.id, { content: 'eins von A' })
  // B slips in between A's planning and A's commit.
  const original = repo.commit.bind(repo)
  let slipped = false
  repo.commit = async (input) => {
    if (!slipped) {
      slipped = true
      await sync(B)
      await on(A)
    }
    return original(input)
  }
  await sync(A)
  repo.commit = original
  await sync(B)
  expect(await chaptersOf(A)).toEqual([['Anfang', 'eins von A'], ['Sturm', 'zwei von B']])
  expect(await chaptersOf(B)).toEqual([['Anfang', 'eins von A'], ['Sturm', 'zwei von B']])
})

test('two devices that each started their own book end up with both', async () => {
  await seedA()
  await on(B)
  const other = await createBook('Zweites')
  await createChapter(other.id, 'Solo', 'b')
  await sync(A)
  await sync(B)
  await sync(A)
  await on(A)
  expect((await listBooks()).map((b) => b.title).sort()).toEqual(['Sturmlied', 'Zweites'])
  await on(B)
  expect((await listBooks()).map((b) => b.title).sort()).toEqual(['Sturmlied', 'Zweites'])
})

test('files the app does not manage are left alone', async () => {
  await seedA()
  const readme = await repo.createBlob('# Meins')
  await repo.commit({ parent: null, baseTree: null, write: new Map([['README.md', readme], ['notizen/frei.txt', readme]]), remove: [], inline: new Map(), message: 'm' })
  await sync(A)
  await sync(A)
  const files = await repo.files()
  expect(files.get('README.md')).toBe('# Meins')
  expect(files.get('notizen/frei.txt')).toBe('# Meins')
})

test('a repository that suddenly looks empty never deletes local books; they are uploaded again', async () => {
  await seedA()
  await sync(A)
  await sync(B)
  repo = createFakeGitHub() // recreated: same name, nothing in it
  const result = await sync(A, async () => {
    throw new Error('must not even ask')
  })
  expect(result.pulled).toBe(0)
  expect(await chaptersOf(A)).toEqual([['Anfang', 'eins'], ['Sturm', 'zwei']])
  expect((await repo.files()).size).toBe(3)
  await sync(B)
  expect(await chaptersOf(B)).toEqual([['Anfang', 'eins'], ['Sturm', 'zwei']])
})

test('what was synced with one repository is not used for another', async () => {
  await seedA()
  await sync(A)
  const other = createFakeGitHub('someone/else')
  const blob = await other.createBlob('fremd')
  await other.commit({ parent: null, baseTree: null, write: new Map([['books/x/chapters/y.md', blob]]), remove: [], inline: new Map(), message: 'm' })
  repo = other
  await sync(A)
  await on(A)
  expect((await listBooks()).length).toBe(2)
  expect((await chaptersOf(A)).length).toBeGreaterThan(0)
})

test('a book deleted on another device is only deleted here after consent', async () => {
  const { book } = await seedA()
  await sync(A)
  await sync(B)
  await on(A)
  await deleteBook(book.id)
  await sync(A)

  const asked: string[][] = []
  await sync(B, async (titles) => {
    asked.push(titles)
    return false
  })
  expect(asked).toEqual([['Sturmlied']])
  expect(await chaptersOf(B)).toEqual([['Anfang', 'eins'], ['Sturm', 'zwei']])
  expect((await repo.files()).size).toBe(3) // kept means: back in the repository

  await on(A)
  await sync(A)
  await deleteBook(book.id)
  await sync(A)
  await sync(B, async () => true)
  await on(B)
  expect(await listBooks()).toEqual([])
})

test('an interrupted run does not merge an outline note twice', async () => {
  const { one } = await seedA()
  await updateChapter(one.id, { outline: 'Basis' })
  await sync(A)
  await sync(B)
  await on(A)
  await updateChapter(one.id, { outline: 'von A' })
  await on(B)
  await updateChapter(one.id, { outline: 'von B' })
  await sync(B)
  await on(A)
  const original = repo.commit.bind(repo)
  let failed = false
  repo.commit = async (input) => {
    if (!failed) {
      failed = true
      throw new GitHubError('offline', 'dropped')
    }
    return original(input)
  }
  await expect(sync(A)).rejects.toBeInstanceOf(GitHubError)
  const result = await sync(A)
  repo.commit = original
  await on(A)
  expect((await getChapter(one.id))!.outline).toBe('von B\n\n--- Fassung von diesem Gerät ---\n\nvon A')
  expect(result.conflicts).toEqual([])
})

test('a restarted run does not turn the other device\'s text into a "this device" copy', async () => {
  const { one } = await seedA()
  await sync(A)
  await sync(B)
  await on(B)
  await updateChapter(one.id, { content: 'v1 von B' })
  await sync(B)
  // While A is committing its own change to another chapter, B pushes v2.
  await on(A)
  const [, second] = await listChapters((await listBooks())[0].id)
  await updateChapter(second.id, { content: 'zwei von A' })
  const original = repo.commit.bind(repo)
  let slipped = false
  repo.commit = async (input) => {
    if (!slipped) {
      slipped = true
      await on(B)
      await updateChapter(one.id, { content: 'v2 von B' })
      await runSync({ ...repo, commit: original } as RemoteApi, { confirmBookDeletion: async () => true })
      await on(A)
    }
    return original(input)
  }
  const result = await sync(A)
  repo.commit = original
  expect(result.conflicts).toEqual([])
  expect(await chaptersOf(A)).toEqual([['Anfang', 'v2 von B'], ['Sturm', 'zwei von A']])
})

test('text files travel inside the commit; only images need separate uploads', async () => {
  const { book } = await seedA()
  const entry = await createEntry(book.id, 'Pascal')
  await addImage(entry.id, { type: 'image/webp', data: new Uint8Array([1, 2, 3]).buffer, width: 1, height: 1 })
  let blobs = 0
  const original = repo.createBlob.bind(repo)
  repo.createBlob = async (data) => {
    blobs++
    return original(data)
  }
  await sync(A)
  expect(blobs).toBe(1)
  expect((await repo.files()).size).toBe(6)
  await sync(B)
  expect((await chaptersOf(B)).length).toBe(2)
})

test('books/ emptied by hand is not read as "delete everything"', async () => {
  await seedA()
  await sync(A)
  const head = (await repo.getHead())!
  const all = [...(await repo.getTree(head.tree)).keys()]
  await repo.commit({ parent: head.commit, baseTree: head.tree, write: new Map(), inline: new Map(), remove: all, message: 'aufgeräumt' })
  await sync(A, async () => {
    throw new Error('must not even ask')
  })
  expect(await chaptersOf(A)).toEqual([['Anfang', 'eins'], ['Sturm', 'zwei']])
  expect((await repo.files()).size).toBe(3)
})

test('deleting the last book still reaches the other device', async () => {
  const { book } = await seedA()
  await sync(A)
  await sync(B)
  await on(A)
  await deleteBook(book.id)
  await sync(A)
  await sync(B, async () => true)
  await on(B)
  expect(await listBooks()).toEqual([])
})

test('tags and templates reach the other device', async () => {
  const { book, two } = await seedA()
  const folder = await createFolder(book.id, 'Characters')
  await sync(A)
  await sync(B)
  await on(A)
  await updateChapter(two.id, { tags: ['PoV: Pascal'] })
  await setFolderTemplate(folder.id, ['Augenfarbe', 'Alter'])
  await sync(A)
  await sync(B)
  await on(B)
  expect((await getChapter(two.id))!.tags).toEqual(['PoV: Pascal'])
  expect((await listFolders(book.id))[0].template).toEqual(['Augenfarbe', 'Alter'])
  const commits = repo.commits
  await sync(B)
  await sync(A)
  expect(repo.commits).toBe(commits)
})
