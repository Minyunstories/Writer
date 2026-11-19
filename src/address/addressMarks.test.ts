import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { GRAMMAR_EVENT, isAddressCheckOn, setAddressCheckOn } from '../grammar/grammarSetting'
import type { AddressFinding } from './addressCheck'
import { addressMarks } from './addressMarks'

let view: EditorView | null = null
beforeEach(() => localStorage.clear())
afterEach(() => {
  view?.destroy()
  view = null
})

const finding = (text: string, doc: string, suggestions: string[] = []): AddressFinding => {
  const from = doc.indexOf(text)
  return { from, to: from + text.length, text, message: `Hinweis zu ${text}`, suggestions }
}

function setup(doc: string, findings: (text: string) => AddressFinding[], on = true) {
  let enabled = on
  view = new EditorView({
    state: EditorState.create({ doc, extensions: addressMarks({ enabled: () => enabled, check: findings, recheckEvent: GRAMMAR_EVENT, delay: 0 }) }),
    parent: document.body,
  })
  return { view, setEnabled: (value: boolean) => (enabled = value) }
}

const marked = (view: EditorView) => [...view.dom.querySelectorAll('.cm-mw-address')].map((mark) => mark.textContent)

test('the setting is off until switched on, and switching checks again', () => {
  expect(isAddressCheckOn()).toBe(false)
  let heard = 0
  const listen = () => heard++
  window.addEventListener(GRAMMAR_EVENT, listen)
  setAddressCheckOn(true)
  window.removeEventListener(GRAMMAR_EVENT, listen)
  expect(isAddressCheckOn()).toBe(true)
  expect(localStorage.getItem('mw:address-check')).toBe('on')
  expect(heard).toBe(1)
})

test('marks what the check finds, with the hint as title; nothing when off', async () => {
  const doc = '“Good day, Lady Brandt.”'
  const { view, setEnabled } = setup(doc, (text) => [finding('Lady Brandt', text)])
  await waitFor(() => expect(marked(view)).toEqual(['Lady Brandt']))
  expect(view.dom.querySelector('.cm-mw-address')).toHaveAttribute('title', 'Hinweis zu Lady Brandt')
  setEnabled(false)
  window.dispatchEvent(new Event(GRAMMAR_EVENT))
  await waitFor(() => expect(marked(view)).toEqual([]))
})

test('the cursor in a mark shows the hint; a suggestion replaces the form', async () => {
  const doc = '“Good day, Lady Brandt.”'
  const { view } = setup(doc, (text) => (text.includes('Lady Brandt') ? [finding('Lady Brandt', text, ['Miss Brandt'])] : []))
  await waitFor(() => expect(marked(view)).toEqual(['Lady Brandt']))
  view.dispatch({ selection: EditorSelection.cursor(doc.indexOf('Brandt')) })
  const box = await waitFor(() => {
    const element = document.querySelector('.cm-mw-address-box')
    expect(element).not.toBeNull()
    return element as HTMLElement
  })
  expect(box).toHaveTextContent('Hinweis zu Lady Brandt')
  ;(box.querySelector('button[aria-label="Ersetzen durch „Miss Brandt“"]') as HTMLButtonElement).click()
  expect(view.state.doc.toString()).toBe('“Good day, Miss Brandt.”')
  await waitFor(() => expect(marked(view)).toEqual([]))
})

test('typing over a mark drops it until the next run', async () => {
  const doc = '“Lady Brandt.”'
  const { view } = setup(doc, (text) => (text.includes('Lady Brandt') ? [finding('Lady Brandt', text)] : []))
  await waitFor(() => expect(marked(view)).toEqual(['Lady Brandt']))
  view.dispatch({ changes: { from: 1, to: 5, insert: 'Miss' } })
  expect(marked(view)).toEqual([])
})
