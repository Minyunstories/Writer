import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

/** Quotes open after the start, a space, a bracket or a dash; otherwise they close. */
const OPENS_AFTER = /[\s([{—–\-“‘/]/

export function curlyQuote(quote: '"' | "'", before: string): string {
  const open = before === '' || OPENS_AFTER.test(before)
  if (quote === '"') return open ? '“' : '”'
  return open ? '‘' : '’'
}

interface Change {
  from: number
  to: number
  original: string
}

const remember = StateEffect.define<Change | null>()

/** The last automatic change, as long as nothing else happened since. */
const lastChange = StateField.define<Change | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(remember)) return effect.value
    return tr.docChanged || tr.selection ? null : value
  },
})

function replace(view: EditorView, from: number, to: number, insert: string, original: string) {
  const end = from + insert.length
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: end },
    effects: remember.of({ from, to: end, original }),
    userEvent: 'input.type',
  })
}

const handler = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view
  if (text === '"' || text === "'") {
    if (from !== to) {
      // A selection gets quotes around it.
      const selected = state.sliceDoc(from, to)
      const [open, close] = text === '"' ? ['“', '”'] : ['‘', '’']
      view.dispatch({ changes: { from, to, insert: `${open}${selected}${close}` }, selection: { anchor: from + 1, head: to + 1 }, userEvent: 'input.type' })
      return true
    }
    replace(view, from, to, curlyQuote(text, state.sliceDoc(from - 1, from)), text)
    return true
  }
  if (from !== to) return false
  const before = state.sliceDoc(from - 1, from)
  if (text === '-' && before === '-') {
    replace(view, from - 1, to, '—', '--')
    return true
  }
  if (text === ' ' && before === '-') {
    const line = state.doc.lineAt(from)
    const ahead = state.sliceDoc(line.from, from - 1)
    // " - " inside a sentence; "- " at the start of a line is a list.
    if (/\s$/.test(ahead) && ahead.trim() !== '') {
      replace(view, from - 1, to, '– ', '- ')
      return true
    }
  }
  return false
})

const undoKey = Prec.high(
  keymap.of([
    {
      key: 'Backspace',
      run: (view) => {
        const change = view.state.field(lastChange, false)
        const selection = view.state.selection.main
        if (!change || !selection.empty || selection.head !== change.to) return false
        view.dispatch({ changes: { from: change.from, to: change.to, insert: change.original }, selection: { anchor: change.from + change.original.length }, userEvent: 'delete' })
        return true
      },
    },
  ]),
)

/** Curly quotes, dashes from "--" and " - " while typing. Backspace right after takes it back. */
export const smartTypography: Extension = [lastChange, handler, undoKey]

const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/

/** The same conversion for text already written. List markers and horizontal rules stay. */
export function typographic(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (RULE.test(line)) return line
      let out = ''
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"' || char === "'") out += curlyQuote(char, out.slice(-1))
        else if (char === '-' && line[i + 1] === '-' && line[i + 2] !== '-') {
          out += '—'
          i++
        } else if (char === '-' && /\s/.test(out.slice(-1)) && /\s/.test(line[i + 1] ?? '') && out.trim() !== '') out += '–'
        else out += char
      }
      return out
    })
    .join('\n')
}
