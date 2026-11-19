import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { findRepeats, type Repeat } from './repeats'

export interface RepeatOptions {
  /** Read on every run: switched off, the marks go away. */
  enabled: () => boolean
  /** Wiki names and aliases: never marked. */
  names: () => readonly string[]
  /** A window event that makes every editor look again (settings or names changed). */
  recheckEvent?: string
  /** Pause after typing before looking again, in ms. */
  delay?: number
}

const setRepeats = StateEffect.define<Repeat[]>()

/** The marked words; between two runs they move with the text, and words typed over drop out. */
const repeatsField = StateField.define<Repeat[]>({
  create: () => [],
  update(repeats, tr) {
    for (const effect of tr.effects) if (effect.is(setRepeats)) return effect.value
    if (!tr.docChanged || repeats.length === 0) return repeats
    const moved: Repeat[] = []
    for (const repeat of repeats) {
      // A change touching the word itself: the word is no longer what was counted.
      let touched = false
      tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA < repeat.to && toA > repeat.from) touched = true
      })
      if (touched) continue
      const from = tr.changes.mapPos(repeat.from, 1)
      const to = tr.changes.mapPos(repeat.to, -1)
      if (from < to) moved.push({ ...repeat, from, to })
    }
    return moved
  },
})

const repeatMark = Decoration.mark({ class: 'cm-mw-repeat', attributes: { title: 'Kommt kurz davor oder danach noch einmal vor' } })
const activeMark = Decoration.mark({ class: 'cm-mw-repeat cm-mw-repeat-active', attributes: { title: 'Kommt kurz davor oder danach noch einmal vor' } })

/** Marks, and stronger ones for the word under the cursor and its siblings. */
const repeatDecorations = EditorView.decorations.compute([repeatsField, 'selection'], (state): DecorationSet => {
  const repeats = state.field(repeatsField)
  if (repeats.length === 0) return Decoration.none
  const head = state.selection.main.head
  const under = repeats.find((repeat) => repeat.from <= head && head <= repeat.to)
  return Decoration.set(repeats.map((repeat) => (under && repeat.group === under.group ? activeMark : repeatMark).range(repeat.from, repeat.to)))
})

const repeatTheme = EditorView.baseTheme({
  // A border, not text-decoration, and a little lower than the wavy lines of the spelling check:
  // on a word with both, both stay visible.
  '.cm-mw-repeat': { borderBottom: '2px dotted rgba(140, 170, 210, 0.75)', paddingBottom: '0.3em' },
  '.cm-mw-repeat-active': { background: 'rgba(140, 170, 210, 0.18)', borderRadius: '2px' },
})

/** Words that come back within a few sentences, marked a moment after typing stops. */
export function repeatMarks(options: RepeatOptions): Extension {
  const delay = options.delay ?? 500
  const runner = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined
      onEvent = () => this.schedule(0)
      constructor(readonly view: EditorView) {
        this.schedule(0)
        if (options.recheckEvent) window.addEventListener(options.recheckEvent, this.onEvent)
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.schedule(delay)
      }
      schedule(wait: number) {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.run(), wait)
      }
      run() {
        const repeats = options.enabled() ? findRepeats(this.view.state.doc.toString(), options.names()) : []
        if (repeats.length === 0 && this.view.state.field(repeatsField).length === 0) return
        this.view.dispatch({ effects: setRepeats.of(repeats) })
      }
      destroy() {
        clearTimeout(this.timer)
        if (options.recheckEvent) window.removeEventListener(options.recheckEvent, this.onEvent)
      }
    },
  )
  return [repeatsField, repeatDecorations, runner, repeatTheme]
}
