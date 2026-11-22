import { EditorState, Facet, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import { countIn, groupKey, groupsFor } from '../collection/collectionComplete'
import type { CollectionItem } from '../types'
import { loadThesaurus, matchCase, synonymGroups, type SynonymGroup, type Thesaurus } from './thesaurus'

/** A word of the collection as offered in the box: how it goes in, and how often the chapter has it. */
interface BankWord {
  text: string
  used: number
}
interface BankGroup {
  title: string
  words: BankWord[]
}

/** Where the box finds the collection (given by the book view). */
const collectionFacet = Facet.define<() => CollectionItem[], (() => CollectionItem[]) | null>({
  combine: (values) => values[0] ?? null,
})
/** Lets the synonym box offer the groups of the collection first. */
export const synonymCollection = (items: () => CollectionItem[]): Extension => collectionFacet.of(items)

interface Lookup {
  from: number
  to: number
  word: string
  groups: SynonymGroup[] | null
  failed?: boolean
  bank: BankGroup[]
}

const setLookup = StateEffect.define<Lookup | null>()

const lookupField = StateField.define<Lookup | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setLookup)) return effect.value
    if (!value) return value
    if (tr.docChanged) return null
    const head = tr.state.selection.main.head
    if (tr.selection && (head < value.from || head > value.to)) return null
    return value
  },
  provide: (field) => showTooltip.from(field, (lookup) => (lookup ? tooltip(lookup) : null)),
})

const MAX_GROUPS = 8
const MAX_BANK_GROUPS = 4
const MARKUP = /\*\*|__|==|[*_]/g

/** The collection's groups for the word (named after it or holding it, also inflected), without the word itself. */
function bankGroups(state: EditorState, word: string, from: number, to: number): BankGroup[] {
  const items = state.facet(collectionFacet)?.() ?? []
  const query = word.replace(/’/g, "'").toLowerCase()
  const keys = items.length ? groupsFor(items, query) : new Set<string>()
  if (keys.size === 0) return []
  const chapter = (state.sliceDoc(0, from) + state.sliceDoc(to)).toLowerCase()
  const groups = new Map<string, BankGroup>()
  for (const item of items) {
    const key = groupKey(item)
    if (!item.group || !keys.has(key) || item.text.replace(MARKUP, '').trim().toLowerCase() === query) continue
    let group = groups.get(key)
    if (!group) {
      if (groups.size >= MAX_BANK_GROUPS) continue
      group = { title: `Sammlung · ${item.category} · ${item.group}`, words: [] }
      groups.set(key, group)
    }
    group.words.push({ text: item.text, used: countIn(chapter, item.text) })
  }
  return [...groups.values()]
}

function tooltip(lookup: Lookup): Tooltip {
  return {
    pos: lookup.from,
    above: false,
    create: (view) => {
      const dom = document.createElement('div')
      dom.className = 'cm-mw-synonyms'
      dom.setAttribute('role', 'dialog')
      dom.setAttribute('aria-label', `Synonyme für „${lookup.word}“`)
      const note = (text: string) => {
        const p = document.createElement('p')
        p.className = 'cm-mw-synonyms-note'
        p.textContent = text
        dom.append(p)
      }
      const replaceWith = (insertText: string) => {
        const insert = matchCase(lookup.word, insertText)
        view.dispatch({
          changes: { from: lookup.from, to: lookup.to, insert },
          selection: { anchor: lookup.from + insert.length },
          effects: setLookup.of(null),
          userEvent: 'input',
        })
        view.focus()
      }
      const section = (heading: string, words: BankWord[]) => {
        const group = document.createElement('div')
        group.className = 'cm-mw-synonyms-group'
        const meaning = document.createElement('p')
        meaning.className = 'cm-mw-synonyms-meaning'
        meaning.textContent = heading
        group.append(meaning)
        const row = document.createElement('div')
        row.className = 'cm-mw-synonyms-words'
        for (const word of words) {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = word.text.replace(MARKUP, '')
          button.dataset.word = button.textContent
          if (word.used) {
            // Already in the chapter: paler, with how often.
            button.classList.add('cm-mw-synonyms-used')
            button.title = `${word.used}× im Kapitel`
            const count = document.createElement('span')
            count.className = 'cm-mw-synonyms-count'
            count.textContent = `${word.used}×`
            button.append(count)
          }
          button.addEventListener('mousedown', (event) => event.preventDefault())
          button.addEventListener('click', () => replaceWith(word.text))
          row.append(button)
        }
        group.append(row)
        dom.append(group)
      }
      for (const group of lookup.bank) section(group.title, group.words)
      if (lookup.failed) note('Die Synonyme konnten nicht geladen werden. Bitte später noch einmal.')
      else if (!lookup.groups) note('Synonyme werden geladen …')
      else if (lookup.groups.length === 0)
        note(lookup.bank.length ? 'Im Wörterbuch keine weiteren Synonyme.' : `Keine Synonyme für „${lookup.word}“.`)
      else
        for (const group of lookup.groups.slice(0, MAX_GROUPS))
          section(`${group.kind} · ${group.meaning}`, group.words.map((text) => ({ text, used: 0 })))
      return { dom }
    },
  }
}

let loader: () => Promise<Thesaurus> = loadThesaurus

/** Opens the synonym box for the selected word or the word at the cursor. */
export function showSynonyms(view: EditorView): boolean {
  const selection = view.state.selection.main
  const range = selection.empty ? view.state.wordAt(selection.head) : selection
  if (!range) return false
  const word = view.state.sliceDoc(range.from, range.to).trim()
  if (!/^[\p{L}'’-]+$/u.test(word)) return false
  const lookup: Lookup = { from: range.from, to: range.to, word, groups: null, bank: bankGroups(view.state, word, range.from, range.to) }
  view.dispatch({ effects: setLookup.of(lookup) })
  const still = () => view.state.field(lookupField, false)?.from === lookup.from
  loader().then(
    (thesaurus) => {
      if (still()) view.dispatch({ effects: setLookup.of({ ...lookup, groups: synonymGroups(thesaurus, word.replace(/’/g, "'")) }) })
    },
    () => {
      if (still()) view.dispatch({ effects: setLookup.of({ ...lookup, failed: true }) })
    },
  )
  return true
}

export function synonyms(options: { load?: () => Promise<Thesaurus> } = {}): Extension {
  if (options.load) loader = options.load
  return [
    lookupField,
    Prec.high(
      keymap.of([
        { key: 'Mod-Shift-s', run: showSynonyms, preventDefault: true },
        {
          key: 'Escape',
          run: (view) => {
            if (!view.state.field(lookupField)) return false
            view.dispatch({ effects: setLookup.of(null) })
            return true
          },
        },
      ]),
    ),
    EditorView.baseTheme({
      '.cm-mw-synonyms': {
        maxWidth: '26rem',
        maxHeight: '18rem',
        overflowY: 'auto',
        padding: '0.6rem 0.7rem',
        fontFamily: 'var(--font-ui)',
        fontSize: '13px',
        lineHeight: '1.45',
      },
      '.cm-mw-synonyms-note': { margin: 0, color: 'var(--text-muted)' },
      '.cm-mw-synonyms-group + .cm-mw-synonyms-group': { marginTop: '8px' },
      '.cm-mw-synonyms-meaning': { margin: '0 0 4px', color: 'var(--text-muted)', fontSize: '12px' },
      '.cm-mw-synonyms-words': { display: 'flex', flexWrap: 'wrap', gap: '4px' },
      '.cm-mw-synonyms-words button.cm-mw-synonyms-used': { opacity: 0.55 },
      '.cm-mw-synonyms-count': { marginLeft: '4px', fontSize: '11px' },
      '.cm-mw-synonyms-words button': {
        font: 'inherit',
        padding: '2px 8px',
        borderRadius: '999px',
        border: '1px solid var(--border)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
      '.cm-mw-synonyms-words button:hover': { background: 'rgba(127, 127, 127, 0.15)' },
    }),
  ]
}
