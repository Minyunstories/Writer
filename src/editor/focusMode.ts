import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'

export const FOCUS_EVENT = 'mw:focus'
const CLASS = 'focus-mode'

export const isFocusMode = () => typeof document !== 'undefined' && document.body.classList.contains(CLASS)

/**
 * Focus mode: only the text, everything else hidden (see the focus-mode styles), the rest of the
 * text dimmed around the paragraph being written. Full screen where the browser allows it.
 */
export function setFocusMode(on: boolean): void {
  if (isFocusMode() === on) return
  document.body.classList.toggle(CLASS, on)
  window.dispatchEvent(new Event(FOCUS_EVENT))
  try {
    if (on && document.fullscreenEnabled && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {})
    if (!on && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  } catch {
    // Full screen is only a nicety.
  }
}

const current = Decoration.line({ class: 'cm-mw-current' })

function paragraphLines(view: EditorView): DecorationSet {
  const { doc } = view.state
  const head = doc.lineAt(view.state.selection.main.head)
  const builder = new RangeSetBuilder<Decoration>()
  if (!head.text.trim()) return builder.finish()
  let first = head.number
  while (first > 1 && doc.line(first - 1).text.trim()) first--
  let last = head.number
  while (last < doc.lines && doc.line(last + 1).text.trim()) last++
  for (let number = first; number <= last; number++) builder.add(doc.line(number).from, doc.line(number).from, current)
  return builder.finish()
}

/** Marks the lines of the paragraph with the cursor; dimming the others is up to the styles. */
export const currentParagraph = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = paragraphLines(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) this.decorations = paragraphLines(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
