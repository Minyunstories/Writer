import type { EditorState, Extension, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { parseSceneBreak } from '../lib/sceneBreak'

/** A named scene break as it is shown: the stars, the name small below. The top line shows only the name. */
class SceneWidget extends WidgetType {
  constructor(
    readonly stars: string | null,
    readonly name: string,
  ) {
    super()
  }

  eq(other: SceneWidget) {
    return other.stars === this.stars && other.name === this.name
  }

  toDOM() {
    const box = document.createElement('span')
    box.className = 'cm-mw-scene'
    if (this.stars) {
      const stars = document.createElement('span')
      stars.className = 'cm-mw-scene-stars'
      stars.textContent = this.stars
      box.append(stars)
    }
    const name = document.createElement('span')
    name.className = 'cm-mw-scene-name'
    name.textContent = this.name
    box.append(name)
    return box
  }

  // A click or tap puts the cursor on the line, which then shows its text.
  ignoreEvent() {
    return false
  }
}

const rawName = Decoration.mark({ class: 'cm-mw-scene-name-raw', attributes: { spellcheck: 'false' } })

/** The first line with text, if it holds a scene name (it names the first scene). */
function topLine(state: EditorState): number | null {
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    if (!line.text.trim()) continue
    return parseSceneBreak(line.text)?.name ? line.from : null
  }
  return null
}

/**
 * Named scene breaks in the given ranges: drawn as stars and name, or as text while the cursor is on them
 * in the focused editor (a chapter opened at its start does not show its top line as text).
 */
export function sceneNameDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  focused = true,
  revealed: readonly { from: number; to: number }[] = [],
): DecorationSet {
  const found: Range<Decoration>[] = []
  let top: number | null | undefined
  for (const { from, to } of ranges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      pos = line.to + 1
      const scene = line.text.includes('*') ? parseSceneBreak(line.text) : null
      if (!scene?.name) continue
      const touches = (range: { from: number; to: number }) => range.from <= line.to && range.to >= line.from
      const editing = (focused && state.selection.ranges.some(touches)) || revealed.some(touches)
      if (editing) {
        const at = line.from + line.text.lastIndexOf(scene.name)
        found.push(rawName.range(at, at + scene.name.length))
      } else {
        if (top === undefined) top = topLine(state)
        const widget = new SceneWidget(top === line.from ? null : scene.stars, scene.name)
        found.push(Decoration.replace({ widget }).range(line.from, line.to))
      }
    }
  }
  return Decoration.set(found, true)
}

interface Options {
  /** Places to show as text even without focus, e.g. what a jump marked (search hit inside a name). */
  reveal?: (state: EditorState) => readonly { from: number; to: number }[]
}

/** Shows the names of scenes ("*** Arrival") below their stars, set off from the text. */
export function sceneNames(options: Options = {}): Extension {
  const build = (view: EditorView) =>
    sceneNameDecorations(view.state, view.visibleRanges, view.hasFocus, options.reveal?.(view.state) ?? [])
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = build(view)
      }

      update(update: ViewUpdate) {
        const revealChanged = !!options.reveal && update.transactions.some((tr) => tr.effects.length > 0)
        if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || revealChanged) {
          this.decorations = build(update.view)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}
