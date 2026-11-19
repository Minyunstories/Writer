import { EditorView } from '@codemirror/view'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { Editor } from '../editor/Editor'
import { createBook, createChapter, deleteBook, getChapter, listBooks, resetDatabaseForTests, updateChapter } from '../storage/db'
import { createFakeGitHub } from './fakeGitHub'
import { loadSyncState } from './local'
import { loadSettings, maskToken, parseRepository, saveSettings } from './settings'
import { SyncProvider } from './SyncProvider'
import { SyncStatus } from './SyncStatus'

let repo: ReturnType<typeof createFakeGitHub>

function renderSync(children: React.ReactNode = null) {
  return render(
    <SyncProvider createApi={() => repo} changeDelay={40} retryDelay={60}>
      <SyncStatus />
      {children}
    </SyncProvider>,
  )
}

const configure = () => saveSettings({ owner: 'me', repo: 'books', token: 'github_pat_abcdefgh1234' })
const status = (text: string) => screen.findByRole('button', { name: new RegExp(`^Sync: ${text}`) }, { timeout: 3000 })

beforeEach(async () => {
  await resetDatabaseForTests()
  localStorage.clear()
  repo = createFakeGitHub()
})

test('repository input accepts owner/name and GitHub links', () => {
  expect(parseRepository('me/books')).toEqual({ owner: 'me', repo: 'books' })
  expect(parseRepository(' https://github.com/Me/My-Books.git ')).toEqual({ owner: 'Me', repo: 'My-Books' })
  expect(parseRepository('https://github.com/me/books/tree/main')).toEqual({ owner: 'me', repo: 'books' })
  expect(parseRepository('books')).toBeNull()
  expect(parseRepository('')).toBeNull()
  expect(maskToken('github_pat_abcdefgh1234')).toBe('••••1234')
})

test('without settings the status says so and nothing is contacted', async () => {
  repo.failNext('other')
  renderSync()
  expect(await status('Nicht eingerichtet')).toBeInTheDocument()
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(repo.commits).toBe(0)
})

test('settings are saved, the token is never shown again, and the first sync runs', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createChapter(book.id, 'Anfang', 'eins')
  renderSync()
  await user.click(await status('Nicht eingerichtet'))
  const dialog = screen.getByRole('dialog', { name: 'Synchronisation' })
  await user.type(within(dialog).getByLabelText('Repository'), 'https://github.com/me/books')
  await user.type(within(dialog).getByLabelText('Zugangsschlüssel'), 'github_pat_abcdefgh1234')
  await user.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  expect(loadSettings()).toEqual({ owner: 'me', repo: 'books', token: 'github_pat_abcdefgh1234' })
  expect(await status('Synchronisiert')).toBeInTheDocument()
  expect((await repo.files()).size).toBe(2)
  expect(within(dialog).getByLabelText('Zugangsschlüssel')).toHaveValue('')
  expect(within(dialog).getByText(/••••1234/)).toBeInTheDocument()
  expect(document.body.textContent).not.toContain('github_pat_abcdefgh1234')
})

test('the connection test explains what is wrong', async () => {
  const user = userEvent.setup()
  renderSync()
  await user.click(await status('Nicht eingerichtet'))
  await user.type(screen.getByLabelText('Repository'), 'me/books')
  await user.type(screen.getByLabelText('Zugangsschlüssel'), 'x')
  const test = screen.getByRole('button', { name: 'Verbindung testen' })
  await user.click(test)
  expect(await screen.findByText('Verbindung steht.')).toBeInTheDocument()
  repo.failNext('auth')
  await user.click(test)
  expect(await screen.findByText(/Zugangsschlüssel wurde abgelehnt/)).toBeInTheDocument()
  repo.failNext('not-found')
  await user.click(test)
  expect(await screen.findByText(/Repository nicht gefunden/)).toBeInTheDocument()
  repo.failNext('offline')
  await user.click(test)
  expect(await screen.findByText(/nicht erreichbar/)).toBeInTheDocument()
  expect(loadSettings()).toBeNull()
})

test('a local change is marked pending and synced after a pause', async () => {
  configure()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', 'eins')
  renderSync()
  expect(await status('Synchronisiert')).toBeInTheDocument()
  const commits = repo.commits
  await updateChapter(chapter.id, { content: 'zwei' })
  expect(await status('Änderungen ausstehend')).toBeInTheDocument()
  expect(await status('Synchronisiert')).toBeInTheDocument()
  expect((await repo.files()).get(`books/${book.id}/chapters/${chapter.id}.md`)).toBe('zwei')
  expect(repo.commits).toBe(commits + 1)
})

test('offline keeps changes pending and catches up when the connection returns', async () => {
  configure()
  const book = await createBook('Sturmlied')
  repo.failNext('offline')
  renderSync()
  expect(await status('Offline')).toBeInTheDocument()
  expect(repo.commits).toBe(0)
  window.dispatchEvent(new Event('online'))
  expect(await status('Synchronisiert')).toBeInTheDocument()
  expect((await repo.files()).has(`books/${book.id}/book.json`)).toBe(true)
})

test('a rejected token stops automatic runs until the settings change', async () => {
  configure()
  const book = await createBook('Sturmlied')
  repo.failNext('auth')
  renderSync()
  expect(await status('Fehler')).toBeInTheDocument()
  await createChapter(book.id, 'Anfang')
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(repo.commits).toBe(0)
  const user = userEvent.setup()
  await user.click(await status('Fehler'))
  expect(screen.getByText(/Zugangsschlüssel wurde abgelehnt/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Jetzt synchronisieren' }))
  expect(await status('Synchronisiert')).toBeInTheDocument()
})

test('other failures are retried with a pause', async () => {
  configure()
  await createBook('Sturmlied')
  repo.failNext('other')
  renderSync()
  expect(await status('Fehler')).toBeInTheDocument()
  expect(await status('Synchronisiert')).toBeInTheDocument()
})

test('conflicts are listed for the writer', async () => {
  configure()
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', 'eins')
  renderSync()
  expect(await status('Synchronisiert')).toBeInTheDocument()
  // Another device changes the chapter while this one changes it too.
  const head = (await repo.getHead())!
  const sha = await repo.createBlob('von woanders')
  await repo.commit({ parent: head.commit, baseTree: head.tree, write: new Map([[`books/${book.id}/chapters/${chapter.id}.md`, sha]]), remove: [], inline: new Map(), message: 'm' })
  await updateChapter(chapter.id, { content: 'von hier' })
  const dialog = await screen.findByRole('alertdialog', { name: 'Konflikte bei der Synchronisation' }, { timeout: 3000 })
  expect(within(dialog).getByText(/Kapitel „Anfang“ in „Sturmlied“/)).toBeInTheDocument()
  expect(within(dialog).getByText(/beide Fassungen/)).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Verstanden' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

test('a pulled chapter appears in the open editor', async () => {
  configure()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', 'eins')
  renderSync(<Editor book={book} chapter={chapter} onChanged={() => {}} />)
  expect(await status('Synchronisiert')).toBeInTheDocument()
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
  const head = (await repo.getHead())!
  const sha = await repo.createBlob('eins und mehr vom Handy')
  await repo.commit({ parent: head.commit, baseTree: head.tree, write: new Map([[`books/${book.id}/chapters/${chapter.id}.md`, sha]]), remove: [], inline: new Map(), message: 'm' })
  const user = userEvent.setup()
  await user.click(await status('Synchronisiert'))
  await user.click(screen.getByRole('button', { name: 'Jetzt synchronisieren' }))
  await waitFor(() => expect(view.state.doc.toString()).toBe('eins und mehr vom Handy'), { timeout: 3000 })
  expect((await getChapter(chapter.id))!.content).toBe('eins und mehr vom Handy')
})

test('disconnecting removes the token and the sync state, never the books', async () => {
  configure()
  const user = userEvent.setup()
  await createBook('Sturmlied')
  renderSync()
  expect(await status('Synchronisiert')).toBeInTheDocument()
  expect(await loadSyncState(repo.id)).toBeDefined()
  await user.click(await status('Synchronisiert'))
  await user.click(screen.getByRole('button', { name: 'Verbindung trennen' }))
  expect(await status('Nicht eingerichtet')).toBeInTheDocument()
  expect(loadSettings()).toBeNull()
  expect(await loadSyncState(repo.id)).toBeUndefined()
  expect((await listBooks()).map((b) => b.title)).toEqual(['Sturmlied'])
  expect((await repo.files()).size).toBe(1)
})

test('typing does not defeat the pause after a failure', async () => {
  configure()
  const book = await createBook('Sturmlied')
  let attempts = 0
  const original = repo.getHead.bind(repo)
  repo.getHead = async () => {
    attempts++
    throw new (await import('./github')).GitHubError('other', 'kaputt')
  }
  render(
    <SyncProvider createApi={() => repo} changeDelay={20} retryDelay={400}>
      <SyncStatus />
    </SyncProvider>,
  )
  expect(await status('Fehler')).toBeInTheDocument()
  for (let i = 0; i < 5; i++) {
    await createChapter(book.id, `K${i}`)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  expect(attempts).toBe(1)
  repo.getHead = original
  expect(await status('Synchronisiert')).toBeInTheDocument()
})

test('offline is retried on its own, even without an online event', async () => {
  configure()
  await createBook('Sturmlied')
  repo.failNext('offline')
  renderSync()
  expect(await status('Offline')).toBeInTheDocument()
  expect(await status('Synchronisiert')).toBeInTheDocument()
})

test('a book deleted on another device asks before it is deleted here', async () => {
  configure()
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  renderSync()
  expect(await status('Synchronisiert')).toBeInTheDocument()
  const head = (await repo.getHead())!
  await repo.commit({ parent: head.commit, baseTree: head.tree, write: new Map(), inline: new Map(), remove: [`books/${book.id}/book.json`], message: 'm' })
  await user.click(await status('Synchronisiert'))
  await user.click(screen.getByRole('button', { name: 'Jetzt synchronisieren' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Buch auf einem anderen Gerät gelöscht' })
  expect(within(dialog).getByText(/„Sturmlied“/)).toBeInTheDocument()
  expect((await listBooks()).length).toBe(1)
  await user.click(within(dialog).getByRole('button', { name: 'Behalten' }))
  await waitFor(async () => expect((await repo.files()).has(`books/${book.id}/book.json`)).toBe(true))
  expect((await listBooks()).length).toBe(1)
  void deleteBook
})

test('new settings saved during a run are used right after it', async () => {
  configure()
  await createBook('Sturmlied')
  const second = createFakeGitHub('me/second')
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const original = repo.getHead.bind(repo)
  repo.getHead = async () => {
    await gate
    return original()
  }
  const first = repo
  render(
    <SyncProvider createApi={(settings) => (settings.repo === 'second' ? second : first)} changeDelay={40} retryDelay={60}>
      <SyncStatus />
    </SyncProvider>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Sync:/ }))
  const repositoryField = screen.getByLabelText('Repository')
  await user.clear(repositoryField)
  await user.type(repositoryField, 'me/second')
  await user.click(screen.getByRole('button', { name: 'Speichern' }))
  release()
  await waitFor(async () => expect((await second.files()).size).toBe(1), { timeout: 3000 })
})

test('changes waiting in the repository from another device are pointed out', async () => {
  configure()
  const { unmount } = render(
    <SyncProvider createApi={() => repo} changeDelay={40} retryDelay={60} checkEvery={50}>
      <SyncStatus />
    </SyncProvider>,
  )
  await status('Synchronisiert')
  const head = (await repo.getHead())!
  await repo.commit({ parent: head.commit, baseTree: head.tree, write: new Map(), inline: new Map([['books/x/book.json', '{}']]), remove: [], message: 'anderes Gerät' })
  expect(await status('Neues vom anderen Gerät')).toBeInTheDocument()
  unmount()
})

test('the sync window offers a backup download, even without a repository', async () => {
  const user = userEvent.setup()
  await createBook('Sturmlied')
  const createObjectURL = vi.fn(() => 'blob:backup')
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    renderSync()
    await user.click(await status('Nicht eingerichtet'))
    const dialog = screen.getByRole('dialog', { name: 'Synchronisation' })
    expect(within(dialog).getByRole('heading', { name: 'Sicherung' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Sicherung herunterladen' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()
  } finally {
    click.mockRestore()
  }
})
