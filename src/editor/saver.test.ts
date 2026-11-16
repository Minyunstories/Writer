import { beforeEach, expect, test, vi } from 'vitest'
import { createBook, createChapter, getChapter, resetDatabaseForTests, updateChapter } from '../storage/db'
import { ChapterSaver, type SaveState } from './saver'

async function setup(overrides: Partial<ConstructorParameters<typeof ChapterSaver>[0]> = {}) {
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'A', 'alt')
  const text = { value: 'alt' }
  const states: SaveState[] = []
  const rescue = vi.fn(async () => {})
  const saver = new ChapterSaver({
    chapterId: chapter.id,
    initialContent: 'alt',
    getContent: () => text.value,
    onState: (s) => states.push(s),
    rescue,
    ...overrides,
  })
  return { chapter, text, states, saver, rescue }
}

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('a change made elsewhere is not overwritten; keeping mine writes it', async () => {
  const { chapter, text, saver } = await setup()
  await updateChapter(chapter.id, { content: 'aus Tab B' })
  text.value = 'aus Tab A'
  saver.contentChanged()
  expect(await saver.flush()).toBe(false)
  expect(saver.state).toBe('conflict')
  expect((await getChapter(chapter.id))!.content).toBe('aus Tab B')
  await saver.keepMine()
  expect(saver.state).toBe('saved')
  expect((await getChapter(chapter.id))!.content).toBe('aus Tab A')
})

test('a failed save stays pending and is retried', async () => {
  let calls = 0
  const save: typeof updateChapter = async (...args) => {
    if (++calls === 1) throw new Error('quota')
    return updateChapter(...args)
  }
  const { chapter, text, saver } = await setup({ save })
  text.value = 'wichtig'
  saver.contentChanged()
  expect(await saver.flush()).toBe(false)
  expect(saver.state).toBe('error')
  expect(saver.hasPending()).toBe(true)
  expect(await saver.flush()).toBe(true)
  expect(saver.state).toBe('saved')
  expect((await getChapter(chapter.id))!.content).toBe('wichtig')
})

test('a failed title save stays pending too', async () => {
  let calls = 0
  const save: typeof updateChapter = async (...args) => {
    if (++calls === 1) throw new Error('quota')
    return updateChapter(...args)
  }
  const { chapter, saver } = await setup({ save })
  saver.titleChanged('Prolog')
  await saver.flush()
  await saver.flush()
  expect((await getChapter(chapter.id))!.title).toBe('Prolog')
})

test('dispose retries a failing save until it lands', async () => {
  let calls = 0
  const save: typeof updateChapter = async (...args) => {
    if (++calls <= 2) throw new Error('flaky')
    return updateChapter(...args)
  }
  const { chapter, text, saver } = await setup({ save, retryBase: 1 })
  text.value = 'letzte Worte'
  saver.contentChanged()
  await saver.dispose()
  expect((await getChapter(chapter.id))!.content).toBe('letzte Worte')
})

test('dispose with an unresolved conflict rescues my text instead of dropping it', async () => {
  const { chapter, text, saver, rescue } = await setup()
  await updateChapter(chapter.id, { content: 'aus Tab B' })
  text.value = 'aus Tab A'
  saver.contentChanged()
  await saver.dispose()
  expect(rescue).toHaveBeenCalledWith('aus Tab A')
  expect((await getChapter(chapter.id))!.content).toBe('aus Tab B')
})

test('checkExternal reports newer stored text when nothing is pending', async () => {
  const { chapter, text, saver } = await setup()
  expect(await saver.checkExternal()).toBeNull()
  await updateChapter(chapter.id, { content: 'von woanders' })
  expect(await saver.checkExternal()).toBe('von woanders')
  text.value = 'von woanders und mehr'
  saver.contentChanged()
  expect(await saver.flush()).toBe(true)
})
