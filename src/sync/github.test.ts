import { expect, test } from 'vitest'
import { createFakeGitHub } from './fakeGitHub'
import { createGitHubApi, GitHubError } from './github'

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
}

function stub(routes: Record<string, (call: Call) => { status?: number; json?: unknown; headers?: Record<string, string> } | Error>) {
  const calls: Call[] = []
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    const key = `${call.method} ${call.url.replace('https://api.github.com/repos/o/r', '')}`
    const handler = routes[key]
    if (!handler) return new Response(JSON.stringify({ message: `no route ${key}` }), { status: 500 })
    const result = handler(call)
    if (result instanceof Error) throw result
    return new Response(JSON.stringify(result.json ?? {}), { status: result.status ?? 200, headers: result.headers })
  }) as typeof fetch
  return { calls, api: createGitHubApi({ owner: 'o', repo: 'r', token: 'secret-token', fetch: fetchStub }) }
}

const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise
    return 'no error'
  } catch (error) {
    return error instanceof GitHubError ? error.kind : `other error: ${String(error)}`
  }
}

const repo = () => ({ json: { default_branch: 'main' } })

test('getHead reads branch, commit and tree, with the token in the header', async () => {
  const { api, calls } = stub({
    'GET ': repo,
    'GET /git/ref/heads/main': () => ({ json: { object: { sha: 'c1' } } }),
    'GET /git/commits/c1': () => ({ json: { tree: { sha: 't1' } } }),
  })
  expect(await api.getHead()).toEqual({ commit: 'c1', tree: 't1' })
  expect(calls.every((call) => call.headers.authorization === 'Bearer secret-token')).toBe(true)
  expect(calls[0].headers.accept).toBe('application/vnd.github+json')
})

test('an empty repository has no head', async () => {
  const { api } = stub({ 'GET ': repo, 'GET /git/ref/heads/main': () => ({ status: 409, json: { message: 'Git Repository is empty.' } }) })
  expect(await api.getHead()).toBeNull()
})

test('trees list blobs only and refuse truncated answers', async () => {
  const { api } = stub({
    'GET /git/trees/t1?recursive=1': () => ({
      json: { truncated: false, tree: [{ path: 'books', type: 'tree', sha: 'x' }, { path: 'books/a.md', type: 'blob', sha: 's1' }] },
    }),
    'GET /git/trees/t2?recursive=1': () => ({ json: { truncated: true, tree: [] } }),
  })
  expect([...(await api.getTree('t1'))]).toEqual([['books/a.md', 's1']])
  expect(await kindOf(api.getTree('t2'))).toBe('other')
})

test('blobs travel as base64, also binary and umlauts', async () => {
  let uploaded = ''
  const { api } = stub({
    'POST /git/blobs': (call) => {
      uploaded = (call.body as { content: string }).content
      expect((call.body as { encoding: string }).encoding).toBe('base64')
      return { status: 201, json: { sha: 'b1' } }
    },
    'GET /git/blobs/b1': () => ({ json: { encoding: 'base64', content: `${uploaded.slice(0, 4)}\n${uploaded.slice(4)}` } }),
  })
  const bytes = new Uint8Array([0, 255, 10, 13, 200])
  expect(await api.createBlob(bytes)).toBe('b1')
  expect([...(await api.getBlob('b1'))]).toEqual([...bytes])
  await api.createBlob('Größe — ok')
  expect(new TextDecoder().decode(await api.getBlob('b1'))).toBe('Größe — ok')
})

test('commit builds tree, commit and moves the branch without force', async () => {
  const { api, calls } = stub({
    'GET ': repo,
    'POST /git/trees': () => ({ status: 201, json: { sha: 't2' } }),
    'POST /git/commits': () => ({ status: 201, json: { sha: 'c2' } }),
    'PATCH /git/refs/heads/main': () => ({ json: {} }),
  })
  const result = await api.commit({ parent: 'c1', baseTree: 't1', write: new Map([['books/a.md', 's1']]), inline: new Map([['books/c.md', 'Größe']]), remove: ['books/b.md'], message: 'Sync' })
  expect(result).toEqual({ commit: 'c2', tree: 't2' })
  const tree = calls.find((call) => call.url.endsWith('/git/trees'))!.body as { base_tree: string; tree: unknown[] }
  expect(tree.base_tree).toBe('t1')
  expect(tree.tree).toEqual([
    { path: 'books/a.md', mode: '100644', type: 'blob', sha: 's1' },
    { path: 'books/c.md', mode: '100644', type: 'blob', content: 'Größe' },
    { path: 'books/b.md', mode: '100644', type: 'blob', sha: null },
  ])
  expect(calls.find((call) => call.url.endsWith('/git/commits'))!.body).toMatchObject({ tree: 't2', parents: ['c1'], message: 'Sync' })
  expect(calls.find((call) => call.method === 'PATCH')!.body).toEqual({ sha: 'c2', force: false })
})

test('a moved branch is reported as a conflict', async () => {
  const { api } = stub({
    'GET ': repo,
    'POST /git/trees': () => ({ status: 201, json: { sha: 't2' } }),
    'POST /git/commits': () => ({ status: 201, json: { sha: 'c2' } }),
    'PATCH /git/refs/heads/main': () => ({ status: 422, json: { message: 'Update is not a fast forward' } }),
  })
  expect(await kindOf(api.commit({ parent: 'c1', baseTree: 't1', write: new Map(), inline: new Map(), remove: ['x'], message: 'm' }))).toBe('conflict')
})

test('an empty repository gets a first commit through the contents API', async () => {
  let created = false
  const { api, calls } = stub({
    'GET ': repo,
    'PUT /contents/README.md': () => {
      created = true
      return { status: 201, json: {} }
    },
    'GET /git/ref/heads/main': () => (created ? { json: { object: { sha: 'c0' } } } : { status: 409, json: {} }),
    'GET /git/commits/c0': () => ({ json: { tree: { sha: 't0' } } }),
    'POST /git/trees': () => ({ status: 201, json: { sha: 't1' } }),
    'POST /git/commits': () => ({ status: 201, json: { sha: 'c1' } }),
    'PATCH /git/refs/heads/main': () => ({ json: {} }),
  })
  expect(await api.commit({ parent: null, baseTree: null, write: new Map([['books/a.md', 's1']]), inline: new Map(), remove: [], message: 'm' })).toEqual({ commit: 'c1', tree: 't1' })
  expect((calls.find((call) => call.url.endsWith('/git/commits'))!.body as { parents: string[] }).parents).toEqual(['c0'])
})

test('errors are classified', async () => {
  const fail = (status: number, headers?: Record<string, string>) => stub({ 'GET ': () => ({ status, json: { message: 'x' }, headers }) }).api.getHead()
  expect(await kindOf(fail(401))).toBe('auth')
  expect(await kindOf(fail(403))).toBe('auth')
  expect(await kindOf(fail(403, { 'x-ratelimit-remaining': '0' }))).toBe('rate-limit')
  expect(await kindOf(fail(429))).toBe('rate-limit')
  expect(await kindOf(fail(404))).toBe('not-found')
  expect(await kindOf(fail(500))).toBe('other')
  expect(await kindOf(stub({ 'GET ': () => new TypeError('Failed to fetch') }).api.getHead())).toBe('offline')
  const secondary = stub({ 'GET ': () => ({ status: 403, json: { message: 'You have exceeded a secondary rate limit. Please wait.' } }) })
  expect(await kindOf(secondary.api.getHead())).toBe('rate-limit')
  expect(stub({}).api.id).toBe('o/r')
})

test('the fake behaves like a repository', async () => {
  const fake = createFakeGitHub()
  expect(await fake.getHead()).toBeNull()
  const text = await fake.createBlob('Hallo')
  const bytes = await fake.createBlob(new Uint8Array([1, 2, 3]))
  const first = await fake.commit({ parent: null, baseTree: null, write: new Map([['books/a.md', text], ['books/b/wiki/_images/i.webp', bytes]]), inline: new Map(), remove: [], message: 'eins' })
  expect(await fake.getHead()).toEqual(first)
  expect([...(await fake.getTree(first.tree)).keys()].sort()).toEqual(['books/a.md', 'books/b/wiki/_images/i.webp'])
  expect(new TextDecoder().decode(await fake.getBlob(text))).toBe('Hallo')

  const second = await fake.commit({ parent: first.commit, baseTree: first.tree, write: new Map(), inline: new Map([['books/c.md', 'Hallo']]), remove: ['books/a.md'], message: 'zwei' })
  expect([...(await fake.getTree(second.tree)).keys()].sort()).toEqual(['books/b/wiki/_images/i.webp', 'books/c.md'])
  expect(await kindOf(fake.commit({ parent: first.commit, baseTree: first.tree, write: new Map(), inline: new Map(), remove: ['books/c.md'], message: 'alt' }))).toBe('conflict')
  expect(fake.commits).toBe(2)
  expect((await fake.files()).get('books/c.md')).toBe('Hallo')

  fake.failNext('offline', 1)
  expect((await fake.getHead())!.commit).toBe(second.commit)
  expect(await kindOf(fake.getHead())).toBe('offline')
  expect((await fake.getHead())!.commit).toBe(second.commit)
})
