import { expect, test } from 'vitest'
import { bookIdOf } from './files'
import { keepBooksWhole, planSync, type Plan } from './plan'

const map = (entries: Record<string, string>) => new Map(Object.entries(entries))
const plan = (base: Record<string, string>, local: Record<string, string>, remote: Record<string, string>) =>
  planSync(map(base), map(local), map(remote))
const nothing: Plan = { push: [], pull: [], deleteRemote: [], deleteLocal: [], conflicts: [] }

test('unchanged files need nothing', () => {
  expect(plan({ a: '1' }, { a: '1' }, { a: '1' })).toEqual(nothing)
})

test('one-sided changes travel to the other side', () => {
  expect(plan({ a: '1' }, { a: '2' }, { a: '1' })).toEqual({ ...nothing, push: ['a'] })
  expect(plan({ a: '1' }, { a: '1' }, { a: '2' })).toEqual({ ...nothing, pull: ['a'] })
})

test('both changed: same content is fine, different content is a conflict', () => {
  expect(plan({ a: '1' }, { a: '2' }, { a: '2' })).toEqual(nothing)
  expect(plan({ a: '1' }, { a: '2' }, { a: '3' })).toEqual({ ...nothing, conflicts: ['a'] })
})

test('new files', () => {
  expect(plan({}, { a: '1' }, {})).toEqual({ ...nothing, push: ['a'] })
  expect(plan({}, {}, { a: '1' })).toEqual({ ...nothing, pull: ['a'] })
  expect(plan({}, { a: '1' }, { a: '1' })).toEqual(nothing)
  expect(plan({}, { a: '1' }, { a: '2' })).toEqual({ ...nothing, conflicts: ['a'] })
})

test('deletions', () => {
  expect(plan({ a: '1' }, {}, { a: '1' })).toEqual({ ...nothing, deleteRemote: ['a'] })
  expect(plan({ a: '1' }, { a: '1' }, {})).toEqual({ ...nothing, deleteLocal: ['a'] })
  expect(plan({ a: '1' }, {}, {})).toEqual(nothing)
})

test('a change beats a deletion', () => {
  expect(plan({ a: '1' }, { a: '2' }, {})).toEqual({ ...nothing, push: ['a'] })
  expect(plan({ a: '1' }, {}, { a: '2' })).toEqual({ ...nothing, pull: ['a'] })
})

test('results are sorted and cover every path once', () => {
  const result = plan({ a: '1', b: '1', c: '1' }, { c: '2', b: '2', d: '1' }, { a: '1', b: '1', c: '1', e: '1' })
  expect(result).toEqual({ push: ['b', 'c', 'd'], pull: ['e'], deleteRemote: ['a'], deleteLocal: [], conflicts: [] })
})

test('a book deleted in the repository but changed here is uploaded again as a whole', () => {
  const base = { 'books/b/book.json': '1', 'books/b/chapters/x.md': '1', 'books/b/chapters/y.md': '1', 'books/c/book.json': '1' }
  const local = { ...base, 'books/b/chapters/x.md': '2' }
  const result = keepBooksWhole(plan(base, local, {}), bookIdOf)
  expect(result.push).toEqual(['books/b/book.json', 'books/b/chapters/x.md', 'books/b/chapters/y.md'])
  expect(result.deleteLocal).toEqual(['books/c/book.json'])
})

test('a book deleted here but changed in the repository is fetched again as a whole', () => {
  const base = { 'books/b/book.json': '1', 'books/b/chapters/x.md': '1', 'books/b/chapters/y.md': '1' }
  const remote = { ...base, 'books/b/chapters/x.md': '2' }
  const result = keepBooksWhole(plan(base, {}, remote), bookIdOf)
  expect(result.pull).toEqual(['books/b/book.json', 'books/b/chapters/x.md', 'books/b/chapters/y.md'])
  expect(result.deleteRemote).toEqual([])
})

test('deleting one chapter in a book that is otherwise active stays a deletion', () => {
  const base = { 'books/b/book.json': '1', 'books/b/chapters/x.md': '1', 'books/b/chapters/y.md': '1' }
  const local = { 'books/b/book.json': '2', 'books/b/chapters/y.md': '1' }
  const result = keepBooksWhole(plan(base, local, base), bookIdOf)
  expect(result.deleteRemote).toEqual(['books/b/chapters/x.md'])
  expect(result.push).toEqual(['books/b/book.json'])
})
