import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import { loadThesaurus, matchCase, synonymGroups, type SynonymGroup, type Thesaurus } from './thesaurus'

interface Lookup {
  from: number
  to: number
  word: string
  groups: SynonymGroup[] | null
  failed?: boolean
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
      if (lookup.failed) note('Die Synonyme konnten nicht geladen werden. Bitte später noch einmal.')
      else if (!lookup.groups) note('Synonyme werden geladen …')
      else if (lookup.groups.length === 0) note(`Keine Synonyme für „${lookup.word}“.`)
      else
        for (const group of lookup.groups.slice(0, MAX_GROUPS)) {
          const section = document.createElement('div')
          section.className = 'cm-mw-synonyms-group'
          const meaning = document.createElement('p')
          meaning.className = 'cm-mw-synonyms-meaning'
          meaning.textContent = `${group.kind} · ${group.meaning}`
          section.append(meaning)
          const words = document.createElement('div')
          words.className = 'cm-mw-synonyms-words'
          for (const word of group.words) {
            const button = document.createElement('button')
            button.type = 'button'
            button.textContent = word
            button.addEventListener('mousedown', (event) => event.preventDefault())
            button.addEventListener('click', () => {
              const insert = matchCase(lookup.word, word)
              view.dispatch({
                changes: { from: lookup.from, to: lookup.to, insert },
                selection: { anchor: lookup.from + insert.length },
                effects: setLookup.of(null),
                userEvent: 'input',
              })
              view.focus()
            })
            words.append(button)
          }
          section.append(words)
          dom.append(section)
        }
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
  const lookup: Lookup = { from: range.from, to: range.to, word, groups: null }
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
