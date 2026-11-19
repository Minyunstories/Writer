import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { isFocusMode, setFocusMode } from '../editor/focusMode'
import { CheckMenu } from './CheckMenu'

beforeEach(() => localStorage.clear())
afterEach(() => setFocusMode(false))

const button = () => screen.getByRole('button', { name: 'Prüfung' })

test('the button opens a menu with both checks', async () => {
  render(<CheckMenu onReturn={() => {}} />)
  expect(button()).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('group', { name: 'Prüfungen' })).not.toBeInTheDocument()
  await userEvent.setup().click(button())
  expect(button()).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('group', { name: 'Prüfungen' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Rechtschreibung und Grammatik' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Wortwiederholungen' })).not.toBeChecked()
})

test('ticking a check stores it, and the button shows when any check is on', async () => {
  const user = userEvent.setup()
  render(<CheckMenu onReturn={() => {}} />)
  expect(button()).toHaveClass('on')
  await user.click(button())
  await user.click(screen.getByRole('checkbox', { name: 'Rechtschreibung und Grammatik' }))
  expect(localStorage.getItem('mw:grammar')).toBe('off')
  expect(button()).not.toHaveClass('on')
  await user.click(screen.getByRole('checkbox', { name: 'Wortwiederholungen' }))
  expect(localStorage.getItem('mw:repeats')).toBe('on')
  expect(button()).toHaveClass('on')
  expect(screen.getByRole('checkbox', { name: 'Wortwiederholungen' })).toBeChecked()
})

test('Esc closes the menu, gives the text back and leaves focus mode on', async () => {
  const onReturn = vi.fn()
  // The editor ends focus mode on an Esc nobody else took; stand in for it here.
  const editorEsc = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented) setFocusMode(false)
  }
  window.addEventListener('keydown', editorEsc)
  setFocusMode(true)
  const user = userEvent.setup()
  render(<CheckMenu onReturn={onReturn} />)
  await user.click(button())
  await user.keyboard('{Escape}')
  window.removeEventListener('keydown', editorEsc)
  expect(screen.queryByRole('group', { name: 'Prüfungen' })).not.toBeInTheDocument()
  expect(onReturn).toHaveBeenCalledTimes(1)
  expect(isFocusMode()).toBe(true)
})

test('a press outside closes, and so does a second click on the button', async () => {
  const user = userEvent.setup()
  render(<CheckMenu onReturn={() => {}} />)
  await user.click(button())
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('group', { name: 'Prüfungen' })).not.toBeInTheDocument()
  await user.click(button())
  expect(screen.getByRole('group', { name: 'Prüfungen' })).toBeInTheDocument()
  await user.click(button())
  expect(screen.queryByRole('group', { name: 'Prüfungen' })).not.toBeInTheDocument()
})

test('the menu opens under the button, outside the scrolling toolbar, and stays inside the window', async () => {
  const width = window.innerWidth
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
  const box = (left: number, top: number, w: number, h: number) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top }) as DOMRect
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('editor-check-menu')) return box(0, 0, 275, 104)
    if (this.classList.contains('editor-grammar')) return box(128, 60, 36, 36)
    return box(0, 0, 0, 0)
  })
  const { container } = render(<CheckMenu onReturn={() => {}} />)
  await userEvent.setup().click(button())
  const menu = screen.getByRole('group', { name: 'Prüfungen' })
  // Not inside the toolbar (which scrolls sideways on small screens and would cut it off).
  expect(container.contains(menu)).toBe(false)
  // Right edge at the button's right edge would be -111 px: moved to the 8 px margin instead.
  expect(menu.style.left).toBe('8px')
  expect(menu.style.top).toBe('102px')
  rect.mockRestore()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
})

test('opened by keyboard, the focus goes into the menu; tabbing out closes it', async () => {
  const user = userEvent.setup()
  render(<CheckMenu onReturn={() => {}} />)
  button().focus()
  await user.keyboard('{Enter}')
  const spelling = screen.getByRole('checkbox', { name: 'Rechtschreibung und Grammatik' })
  expect(document.activeElement).toBe(spelling)
  await user.keyboard(' ')
  expect(localStorage.getItem('mw:grammar')).toBe('off')
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Wortwiederholungen' }))
  await user.tab()
  expect(screen.queryByRole('group', { name: 'Prüfungen' })).not.toBeInTheDocument()
})

test('the button is a plain disclosure, not announced as a menu', () => {
  render(<CheckMenu onReturn={() => {}} />)
  expect(button()).not.toHaveAttribute('aria-haspopup')
})

test('ticking with the mouse leaves the focus in the text', async () => {
  const user = userEvent.setup()
  render(
    <>
      <textarea aria-label="Text" />
      <CheckMenu onReturn={() => {}} />
    </>,
  )
  const text = screen.getByRole('textbox', { name: 'Text' })
  text.focus()
  await user.click(button())
  await user.click(screen.getByRole('checkbox', { name: 'Wortwiederholungen' }))
  expect(localStorage.getItem('mw:repeats')).toBe('on')
  expect(document.activeElement).toBe(text)
  expect(screen.getByRole('group', { name: 'Prüfungen' })).toBeInTheDocument()
})

test('"Anreden" appears only with the module on; ticking it stores it and lights the button', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<CheckMenu onReturn={() => {}} />)
  await user.click(button())
  expect(screen.queryByRole('checkbox', { name: 'Anreden' })).not.toBeInTheDocument()
  rerender(<CheckMenu onReturn={() => {}} address />)
  await user.click(screen.getByRole('checkbox', { name: 'Rechtschreibung und Grammatik' }))
  expect(button()).not.toHaveClass('on')
  const address = screen.getByRole('checkbox', { name: 'Anreden' })
  expect(address).not.toBeChecked()
  await user.click(address)
  expect(localStorage.getItem('mw:address-check')).toBe('on')
  expect(button()).toHaveClass('on')
})
