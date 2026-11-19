import { beforeEach, expect, test } from 'vitest'
import { resetDatabaseForTests } from './connection'
import { addComment } from './comments'
import { changeChapterTags, createBook, createChapter, getChapter, listChapters, setChapterDate, setChapterStatus, updateChapter } from './db'
import { createGroup, setChapterGroup } from './groups'
import { isSplitLine, mergeWithNext, splitChapter } from './split'
import { listTrash } from './trash'
import { listVersions } from './versions'

beforeEach(async () => {
  await resetDatabaseForTests()
})

const TEXT = 'Mira closed the door.\n\nShe waited.\n\n## Der lange Winter\n\nSnow came early that year.\n\nLea laughed.'
const LINE = TEXT.indexOf('## Der')

async function setup(content = TEXT) {
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang', content)
  const c = await createChapter(book.id, 'Ende', 'Zum Schluss.')
  return { book, a, c }
}

test('isSplitLine: exactly two # and a title', () => {
  expect(isSplitLine('## Der lange Winter')).toBe(true)
  expect(isSplitLine('##   Teil **zwei**  ')).toBe(true)
  expect(isSplitLine('# Teil')).toBe(false)
  expect(isSplitLine('### Teil')).toBe(false)
  expect(isSplitLine('##')).toBe(false)
  expect(isSplitLine('##Teil')).toBe(false)
  expect(isSplitLine('Text ## Teil')).toBe(false)
})

test('splitting makes the heading a chapter right after, with everything from there', async () => {
  const { book, a } = await setup()
  const created = await splitChapter(a.id, LINE)
  expect(created).toMatchObject({ title: 'Der lange Winter', content: 'Snow came early that year.\n\nLea laughed.' })
  expect((await getChapter(a.id))!.content).toBe('Mira closed the door.\n\nShe waited.')
  expect((await listChapters(book.id)).map((c) => c.title)).toEqual(['Anfang', 'Der lange Winter', 'Ende'])
  const versions = await listVersions(a.id)
  expect(versions.map((v) => [v.label, v.content])).toEqual([['Vor dem Teilen', TEXT]])
})

test('the new chapter takes status, group, tags and date; the outline stays', async () => {
  const { book, a } = await setup()
  await updateChapter(a.id, { outline: 'Regen' })
  await changeChapterTags(a.id, { add: 'Mira' })
  await setChapterDate(a.id, 'März')
  await setChapterStatus(a.id, 'draft')
  const group = await createGroup(book.id, 'Teil 1')
  await setChapterGroup(a.id, group.id)
  const created = await splitChapter(a.id, LINE)
  expect(created).toMatchObject({ status: 'draft', group: group.id, tags: ['Mira'], date: 'März' })
  expect(created!.outline).toBeUndefined()
  expect((await getChapter(a.id))!.outline).toBe('Regen')
})

test('comments go with their text', async () => {
  const { a } = await setup()
  const before = TEXT.indexOf('She')
  const after = TEXT.indexOf('Lea')
  const across = TEXT.indexOf('waited')
  await addComment(a.id, { from: before, to: before + 3, quote: 'She', text: 'vorn' })
  await addComment(a.id, { from: after, to: after + 3, quote: 'Lea', text: 'hinten' })
  await addComment(a.id, { from: across, to: after + 3, quote: 'quer', text: 'über die Grenze' })
  const created = await splitChapter(a.id, LINE)
  const first = (await getChapter(a.id))!
  expect(first.comments!.map((c) => [c.text, first.content.slice(c.from, c.to)])).toEqual([
    ['vorn', 'She'],
    ['über die Grenze', 'waited.'],
  ])
  expect(created!.comments!.map((c) => [c.text, created!.content.slice(c.from, c.to)])).toEqual([['hinten', 'Lea']])
})

test('only a ## line splits', async () => {
  const { a } = await setup('Eins\n\n### Klein\n\nZwei')
  expect(await splitChapter(a.id, 'Eins\n\n'.length)).toBeNull()
  expect(await splitChapter(a.id, 2)).toBeNull()
  expect(await splitChapter('nope', 0)).toBeNull()
})

test('a heading on the first line leaves an empty first part; Windows line ends work too', async () => {
  const { a } = await setup('## Neu\r\n\r\nText.')
  const created = await splitChapter(a.id, 0)
  expect(created).toMatchObject({ title: 'Neu', content: 'Text.' })
  expect((await getChapter(a.id))!.content).toBe('')
})

test('merging appends the next chapter under a ## heading and puts it in the trash', async () => {
  const { book, a, c } = await setup('Erster Teil.\n\n')
  await updateChapter(a.id, { outline: 'Eins' })
  await updateChapter(c.id, { outline: 'Zwei' })
  await changeChapterTags(a.id, { add: 'Mira' })
  await changeChapterTags(c.id, { add: 'Lea' })
  await addComment(c.id, { from: 4, to: 10, quote: 'Schlus', text: 'hinten' })
  const result = await mergeWithNext(a.id)
  const merged = (await getChapter(a.id))!
  expect(merged.content).toBe('Erster Teil.\n\n## Ende\n\nZum Schluss.')
  expect(merged.outline).toBe('Eins\n\nZwei')
  expect(merged.tags).toEqual(['Mira', 'Lea'])
  expect(merged.comments!.map((comment) => merged.content.slice(comment.from, comment.to))).toEqual(['Schlus'])
  expect(result!.trashed.title).toBe('Ende')
  expect((await listChapters(book.id)).map((ch) => ch.title)).toEqual(['Anfang'])
  expect((await listTrash(book.id)).map((item) => item.title)).toEqual(['Ende'])
  expect((await listVersions(a.id)).map((v) => v.label)).toEqual(['Vor dem Zusammenführen'])
})

test('splitting and merging again gives the text back', async () => {
  const { a } = await setup()
  await splitChapter(a.id, LINE)
  await mergeWithNext(a.id)
  expect((await getChapter(a.id))!.content).toBe(TEXT)
})

test('the last chapter has nothing to merge with', async () => {
  const { c } = await setup()
  expect(await mergeWithNext(c.id)).toBeNull()
})

test('markdown marks do not end up in the chapter title', async () => {
  const { a } = await setup('Eins\n\n## Teil **zwei** und ==drei==  \n\nText')
  expect((await splitChapter(a.id, 'Eins\n\n'.length))!.title).toBe('Teil zwei und drei')
})
