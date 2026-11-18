import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { createBook, createChapter, resetDatabaseForTests } from '../storage/db'
import { autoVersion, listVersions, saveVersion } from '../storage/versions'
import { VersionsDialog } from './VersionsDialog'

beforeEach(async () => {
  await resetDatabaseForTests()
})

async function setup(current: string) {
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'Anfang', current)
  const onRestore = vi.fn()
  return { chapter, onRestore, open: () => render(<VersionsDialog chapter={chapter} current={() => current} onRestore={onRestore} onClose={() => {}} />) }
}

test('the current text is saved with a name and listed', async () => {
  const user = userEvent.setup()
  const { chapter, open } = await setup('Der Sturm kam.')
  open()
  const dialog = screen.getByRole('dialog', { name: 'Fassungen von „Anfang“' })
  expect(await within(dialog).findByText(/Noch keine Fassungen/)).toBeInTheDocument()
  await user.type(within(dialog).getByLabelText('Name der Fassung'), 'Erster Entwurf')
  await user.click(within(dialog).getByRole('button', { name: 'Jetzt sichern' }))
  expect(await within(dialog).findByRole('button', { name: /Erster Entwurf/ })).toBeInTheDocument()
  expect((await listVersions(chapter.id))[0]).toMatchObject({ label: 'Erster Entwurf', content: 'Der Sturm kam.' })
})

test('a version shows what changed since; restoring keeps the current text as a version first', async () => {
  const user = userEvent.setup()
  const { chapter, onRestore, open } = await setup('Der Sturm kam spät.')
  await autoVersion(chapter, 'Der Regen kam spät.')
  open()
  const dialog = screen.getByRole('dialog')
  await user.click(await within(dialog).findByRole('button', { name: /Automatisch/ }))
  expect(within(dialog).getByText('Regen', { selector: 'del' })).toBeInTheDocument()
  expect(within(dialog).getByText('Sturm', { selector: 'ins' })).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Diese Fassung wiederherstellen' }))
  await waitFor(() => expect(onRestore).toHaveBeenCalledWith('Der Regen kam spät.'))
  expect((await listVersions(chapter.id)).find((v) => v.label === 'Vor dem Wiederherstellen')?.content).toBe('Der Sturm kam spät.')
})

test('a version can be renamed and deleted', async () => {
  const user = userEvent.setup()
  const { chapter, open } = await setup('jetzt')
  await saveVersion(chapter, 'damals', 'Alt')
  open()
  const dialog = screen.getByRole('dialog')
  await user.click(await within(dialog).findByRole('button', { name: /Alt/ }))
  await user.clear(within(dialog).getByLabelText('Name dieser Fassung'))
  await user.type(within(dialog).getByLabelText('Name dieser Fassung'), 'Uralt{Enter}')
  await waitFor(async () => expect((await listVersions(chapter.id))[0].label).toBe('Uralt'))
  await user.click(within(dialog).getByRole('button', { name: 'Löschen' }))
  await waitFor(async () => expect(await listVersions(chapter.id)).toEqual([]))
})
