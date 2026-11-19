import { Facet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, showTooltip, ViewPlugin, type DecorationSet, type Tooltip, type ViewUpdate } from '@codemirror/view'
import type { ChapterComment } from '../types'

interface Mark {
  id: string
  from: number
  to: number
  text: string
  done: boolean
}

export interface CommentOptions {
  onAdd: (place: { from: number; to: number; quote: string }) => Promise<ChapterComment>
  onUpdate: (id: string, patch: { text?: string; done?: boolean }) => void
  onDelete: (id: string) => void
  /** Where the comments are after the text changed. */
  onPlace: (places: { id: string; from: number; to: number; quote: string }[]) => void
  placeDelay?: number
}

interface State {
  marks: Mark[]
  /** The comment being written, if any. */
  editing: string | null
}

const setMarks = StateEffect.define<Mark[]>()
const setEditing = StateEffect.define<string | null>()

const toMark = (comment: ChapterComment): Mark => ({ id: comment.id, from: comment.from, to: comment.to, text: comment.text, done: comment.done })

const field = StateField.define<State>({
  create: () => ({ marks: [], editing: null }),
  update(value, tr) {
    let { marks, editing } = value
    if (tr.docChanged)
      marks = marks.map((mark) => {
        const from = tr.changes.mapPos(mark.from, 1)
        return { ...mark, from, to: Math.max(from, tr.changes.mapPos(mark.to, -1)) }
      })
    for (const effect of tr.effects) {
      if (effect.is(setMarks)) marks = effect.value
      if (effect.is(setEditing)) editing = effect.value
    }
    if (editing && !marks.some((mark) => mark.id === editing)) editing = null
    return marks === value.marks && editing === value.editing ? value : { marks, editing }
  },
  provide: (f) =>
    EditorView.decorations.from(f, (state): DecorationSet =>
      Decoration.set(
        state.marks.filter((mark) => !mark.done && mark.to > mark.from).map((mark) => commentMark.range(mark.from, mark.to)),
        true,
      ),
    ),
})

const commentMark = Decoration.mark({ class: 'cm-mw-comment' })

/** The comments' places in the current text, for storing. */
export function currentPlaces(state: EditorState) {
  return state.field(field).marks.map((mark) => ({ id: mark.id, from: mark.from, to: mark.to, quote: state.sliceDoc(mark.from, mark.to) }))
}

/**
 * Takes over comments changed elsewhere (the panel, another device). Places already known here
 * stay as they are: while the chapter is open, the editor knows best where the words are.
 * `trustGiven`: right after stored text came into the editor, the given (stored) places are the
 * right ones – a merge or rename may have moved comments the editor had only guessed at.
 */
export function refreshComments(view: EditorView, comments: ChapterComment[], options: { trustGiven?: boolean } = {}) {
  const known = new Map(view.state.field(field).marks.map((mark) => [mark.id, mark]))
  const length = view.state.doc.length
  const marks = comments.map((comment) => {
    const here = known.get(comment.id)
    const mark = toMark(comment)
    if (here && !options.trustGiven) return { ...mark, from: here.from, to: here.to }
    return { ...mark, from: Math.min(mark.from, length), to: Math.min(mark.to, length) }
  })
  view.dispatch({ effects: setMarks.of(marks) })
}

const optionsOf = (view: EditorView): CommentOptions | null => view.state.facet(optionsFacet)

const optionsFacet = Facet.define<CommentOptions, CommentOptions | null>({ combine: (values) => values[0] ?? null })

/** Starts a comment on the selected words. */
export function addCommentAtSelection(view: EditorView): boolean {
  const options = optionsOf(view)
  const selection = view.state.selection.main
  if (!options || selection.empty) return false
  const place = { from: selection.from, to: selection.to, quote: view.state.sliceDoc(selection.from, selection.to) }
  void options.onAdd(place).then((comment) => {
    const marks = view.state.field(field).marks
    view.dispatch({
      effects: [setMarks.of([...marks, { ...toMark(comment), from: place.from, to: place.to }].sort((a, b) => a.from - b.from)), setEditing.of(comment.id)],
      selection: { anchor: place.to },
    })
  })
  return true
}

function commentBox(view: EditorView, mark: Mark, editing: boolean, options: CommentOptions) {
  const dom = document.createElement('div')
  dom.className = 'cm-mw-comment-box'
  const remove = () => {
    options.onDelete(mark.id)
    view.dispatch({ effects: setMarks.of(view.state.field(field).marks.filter((other) => other.id !== mark.id)) })
    view.focus()
  }
  const update = (patch: { text?: string; done?: boolean }) => {
    options.onUpdate(mark.id, patch)
    view.dispatch({
      effects: [setMarks.of(view.state.field(field).marks.map((other) => (other.id === mark.id ? { ...other, ...patch } : other))), setEditing.of(null)],
    })
  }
  const button = (label: string, action: string, run: () => void) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = label
    element.dataset.action = action
    element.addEventListener('mousedown', (event) => event.preventDefault())
    element.addEventListener('click', run)
    return element
  }

  if (editing) {
    const area = document.createElement('textarea')
    area.value = mark.text
    area.rows = 3
    area.placeholder = 'Kommentar … (Enter speichert, Esc bricht ab)'
    area.setAttribute('aria-label', 'Kommentar')
    let finished = false
    const save = () => {
      if (finished) return
      finished = true
      const text = area.value.trim()
      if (!text && !mark.text) remove()
      else if (text && text !== mark.text) update({ text })
      else view.dispatch({ effects: setEditing.of(null) })
      view.focus()
    }
    area.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        save()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        finished = true
        if (!mark.text) remove()
        else view.dispatch({ effects: setEditing.of(null) })
        view.focus()
      }
    })
    // Leaving the field saves, but never in the middle of an editor update (the box may be going away).
    area.addEventListener('blur', () => setTimeout(save, 0))
    dom.append(area)
    setTimeout(() => area.focus(), 0)
    return dom
  }

  const text = document.createElement('p')
  text.textContent = mark.text || '(leer)'
  dom.append(text)
  const actions = document.createElement('div')
  actions.className = 'cm-mw-comment-actions'
  actions.append(
    button('Bearbeiten', 'edit', () => view.dispatch({ effects: setEditing.of(mark.id) })),
    button('Erledigt', 'done', () => {
      update({ done: true })
      view.focus()
    }),
    button('Löschen', 'delete', remove),
  )
  dom.append(actions)
  return dom
}

/** The same box object as long as nothing about it changed: a new one would replace the old box (and its text field). */
let lastKey = ''
let lastTooltip: Tooltip | null = null

const tooltip = showTooltip.compute(['selection', field], (state): Tooltip | null => {
  const { marks, editing } = state.field(field)
  const head = state.selection.main.head
  const mark = editing
    ? marks.find((candidate) => candidate.id === editing)
    : state.selection.main.empty
      ? marks.find((candidate) => !candidate.done && candidate.from <= head && head <= candidate.to && candidate.to > candidate.from)
      : undefined
  if (!mark) return null
  const key = JSON.stringify([mark, mark.id === editing])
  if (key === lastKey && lastTooltip) return lastTooltip
  lastKey = key
  lastTooltip = {
    pos: mark.from,
    above: false,
    create: (view) => {
      const options = optionsOf(view)
      return { dom: options ? commentBox(view, mark, mark.id === editing, options) : document.createElement('div') }
    },
  }
  return lastTooltip
})

/** Comments on stretches of text: marked, shown in a box at the cursor, kept in place while writing. */
export function commentMarks(initial: ChapterComment[], options: CommentOptions): Extension {
  const delay = options.placeDelay ?? 1500
  return [
    optionsFacet.of(options),
    field.init(() => ({ marks: initial.map(toMark), editing: null })),
    tooltip,
    ViewPlugin.fromClass(
      class {
        timer: ReturnType<typeof setTimeout> | undefined
        constructor(readonly view: EditorView) {}
        update(update: ViewUpdate) {
          if (!update.docChanged || update.state.field(field).marks.length === 0) return
          clearTimeout(this.timer)
          this.timer = setTimeout(() => options.onPlace(currentPlaces(this.view.state)), delay)
        }
        destroy() {
          if (this.timer === undefined) return
          clearTimeout(this.timer)
          // Store the last places before the editor goes away.
          options.onPlace(currentPlaces(this.view.state))
        }
      },
    ),
    EditorView.baseTheme({
      '.cm-mw-comment': {
        backgroundColor: 'rgba(120, 160, 220, 0.16)',
        borderBottom: '2px solid rgba(120, 160, 220, 0.75)',
      },
      '.cm-mw-comment-box': {
        maxWidth: '24rem',
        padding: '0.6rem 0.7rem',
        fontFamily: 'var(--font-ui)',
        fontSize: '13px',
        lineHeight: '1.45',
      },
      '.cm-mw-comment-box p': { margin: '0 0 0.5rem', whiteSpace: 'pre-wrap' },
      '.cm-mw-comment-box textarea': {
        width: '20rem',
        maxWidth: '100%',
        font: 'inherit',
        padding: '0.4rem 0.5rem',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        background: 'var(--bg)',
        color: 'var(--text)',
        resize: 'vertical',
      },
      '.cm-mw-comment-actions': { display: 'flex', gap: '0.35rem' },
      '.cm-mw-comment-actions button': { padding: '0.25rem 0.6rem', fontSize: '12px' },
    }),
  ]
}
