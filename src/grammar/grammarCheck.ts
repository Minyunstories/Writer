import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, showTooltip, ViewPlugin, type DecorationSet, type Tooltip, type ViewUpdate } from '@codemirror/view'

/** One finding of the check, in document positions. */
export interface GrammarItem {
  from: number
  to: number
  message: string
  /** Harper's category, e.g. "Spelling" or "Agreement". */
  kind: string
  suggestions: { label: string; insert: string }[]
  /** For unknown words: the word, so it can be accepted. */
  word?: string
  /** For ignoring this spot later. */
  hash?: string
}

export interface GrammarOptions {
  check: (text: string) => Promise<GrammarItem[]>
  onAddWord: (word: string) => void
  onIgnore: (hash: string) => void
  /** Read on every run, so switching it needs only a recheck. */
  enabled: () => boolean
  /** Quiet time after typing before the text is checked. */
  delay?: number
  /** A window event that makes every open text check again. */
  recheckEvent?: string
}

/** Check again now, e.g. after the word list changed or the check was switched on or off. */
export const recheckGrammar = StateEffect.define<null>()
const setItems = StateEffect.define<GrammarItem[]>()

const mark = Decoration.mark({ class: 'cm-mw-grammar' })
const spellingMark = Decoration.mark({ class: 'cm-mw-grammar cm-mw-spelling' })

const itemsField = StateField.define<GrammarItem[]>({
  create: () => [],
  update(items, tr) {
    for (const effect of tr.effects) if (effect.is(setItems)) return effect.value
    if (!tr.docChanged || items.length === 0) return items
    // Keep marks in place while typing; ones whose text was edited go until the next run.
    return items.flatMap((item) => {
      if (tr.changes.touchesRange(item.from, item.to)) return []
      return [{ ...item, from: tr.changes.mapPos(item.from, 1), to: tr.changes.mapPos(item.to, -1) }]
    })
  },
  provide: (field) => [
    EditorView.decorations.from(field, (items): DecorationSet =>
      Decoration.set(
        items.filter((item) => item.to > item.from).map((item) => (item.kind === 'Spelling' ? spellingMark : mark).range(item.from, item.to)),
        true,
      ),
    ),
  ],
})

function tooltipFor(options: GrammarOptions) {
  return showTooltip.compute(['selection', itemsField], (state): Tooltip | null => {
    const selection = state.selection.main
    if (!selection.empty) return null
    const item = state.field(itemsField).find((candidate) => candidate.from <= selection.head && selection.head <= candidate.to)
    if (!item) return null
    return {
      pos: item.from,
      above: false,
      create: (view) => {
        const dom = document.createElement('div')
        dom.className = 'cm-mw-grammar-box'
        const message = document.createElement('p')
        message.textContent = item.message
        dom.append(message)
        const actions = document.createElement('div')
        actions.className = 'cm-mw-grammar-actions'
        const button = (label: string, run: () => void, extra: Record<string, string> = {}) => {
          const element = document.createElement('button')
          element.type = 'button'
          element.textContent = label
          for (const [name, value] of Object.entries(extra)) element.setAttribute(name, value)
          // Keep the cursor in the text.
          element.addEventListener('mousedown', (event) => event.preventDefault())
          element.addEventListener('click', run)
          actions.append(element)
          return element
        }
        for (const suggestion of item.suggestions.slice(0, 4)) {
          const label = suggestion.insert === '' ? 'Entfernen' : suggestion.label
          button(
            label,
            () => {
              view.dispatch({
                changes: { from: item.from, to: item.to, insert: suggestion.insert },
                selection: { anchor: item.from + suggestion.insert.length },
                userEvent: 'input',
              })
              view.focus()
            },
            { class: 'primary-choice', 'aria-label': suggestion.insert === '' ? 'Entfernen' : `Ersetzen durch „${suggestion.insert}“` },
          )
        }
        const close = () => view.dispatch({ effects: setItems.of(view.state.field(itemsField).filter((other) => other !== item)) })
        if (item.word)
          button(
            'Als richtig merken',
            () => {
              options.onAddWord(item.word!)
              close()
            },
            { 'data-action': 'word' },
          )
        if (item.hash)
          button(
            'Ignorieren',
            () => {
              options.onIgnore(item.hash!)
              close()
            },
            { 'data-action': 'ignore' },
          )
        dom.append(actions)
        return { dom }
      },
    }
  })
}

/** Spelling and grammar marks from a checker, refreshed a moment after typing stops. */
export function grammarCheck(options: GrammarOptions): Extension {
  const delay = options.delay ?? 800
  const runner = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined
      run = 0
      onEvent = () => this.schedule(0)
      constructor(readonly view: EditorView) {
        this.schedule(0)
        if (options.recheckEvent) window.addEventListener(options.recheckEvent, this.onEvent)
      }
      update(update: ViewUpdate) {
        const asked = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(recheckGrammar)))
        if (asked) this.schedule(0)
        else if (update.docChanged) this.schedule(delay)
      }
      schedule(wait: number) {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.check(), wait)
      }
      async check() {
        const run = ++this.run
        if (!options.enabled()) {
          if (this.view.state.field(itemsField).length > 0) this.view.dispatch({ effects: setItems.of([]) })
          return
        }
        const doc = this.view.state.doc
        let items: GrammarItem[]
        try {
          items = await options.check(doc.toString())
        } catch {
          return
        }
        // Text changed meanwhile, or a newer run started: these results are out of date.
        if (run !== this.run || this.view.state.doc !== doc) return
        const length = doc.length
        this.view.dispatch({ effects: setItems.of(items.filter((item) => item.from >= 0 && item.to <= length && item.from < item.to)) })
      }
      destroy() {
        clearTimeout(this.timer)
        this.run++
        if (options.recheckEvent) window.removeEventListener(options.recheckEvent, this.onEvent)
      }
    },
  )
  return [itemsField, runner, tooltipFor(options), grammarTheme]
}

const grammarTheme = EditorView.baseTheme({
  '.cm-mw-grammar': {
    textDecoration: 'underline wavy rgba(217, 178, 106, 0.85)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '0.25em',
  },
  '.cm-mw-spelling': {
    textDecorationColor: 'rgba(229, 154, 140, 0.9)',
  },
  '.cm-tooltip:has(> .cm-mw-grammar-box)': {
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.45)',
    color: 'var(--text)',
  },
  '.cm-mw-grammar-box': {
    maxWidth: '22rem',
    padding: '0.6rem 0.7rem',
    fontFamily: 'var(--font-ui)',
    fontSize: '13px',
    lineHeight: '1.45',
  },
  '.cm-mw-grammar-box p': { margin: '0 0 0.5rem' },
  '.cm-mw-grammar-actions': { display: 'flex', flexWrap: 'wrap', gap: '0.35rem' },
  '.cm-mw-grammar-actions button': {
    padding: '0.3rem 0.6rem',
    borderRadius: '999px',
    fontSize: '13px',
  },
  '.cm-mw-grammar-actions button.primary-choice': {
    borderColor: 'var(--accent)',
    fontWeight: '600',
  },
})
