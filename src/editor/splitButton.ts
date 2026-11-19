import { type EditorState, type Extension, RangeSet } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { isSplitLine } from '../storage/split'

class SplitWidget extends WidgetType {
  constructor(
    readonly lineFrom: number,
    readonly onSplit: (lineFrom: number) => void,
  ) {
    super()
  }

  eq(other: SplitWidget) {
    return other.lineFrom === this.lineFrom
  }

  toDOM() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-mw-split'
    button.textContent = 'In neues Kapitel'
    button.title = 'Ab dieser Zeile ein eigenes Kapitel daraus machen'
    // Keep the cursor in the text.
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      this.onSplit(this.lineFrom)
    })
    return button
  }

  ignoreEvent() {
    return true
  }
}

function buttonFor(state: EditorState, onSplit: (lineFrom: number) => void): DecorationSet {
  const line = state.doc.lineAt(state.selection.main.head)
  if (!isSplitLine(line.text)) return RangeSet.empty
  return Decoration.set([Decoration.widget({ widget: new SplitWidget(line.from, onSplit), side: 1 }).range(line.to)])
}

/** A "## Title" line with the cursor in it gets a button that turns everything from there into a new chapter. */
export function splitButton(onSplit: (lineFrom: number) => void): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buttonFor(view.state, onSplit)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) this.decorations = buttonFor(update.state, onSplit)
      }
    },
    { decorations: (value) => value.decorations },
  )
  const theme = EditorView.baseTheme({
    '.cm-mw-split': {
      marginLeft: '1rem',
      padding: '0.15rem 0.6rem',
      verticalAlign: 'middle',
      border: '1px solid var(--border)',
      borderRadius: '999px',
      background: 'var(--surface-2)',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-ui)',
      fontSize: '12px',
      fontWeight: '400',
      lineHeight: '1.5',
      letterSpacing: '0',
      cursor: 'pointer',
    },
    '.cm-mw-split:hover': { color: 'var(--text)', borderColor: 'var(--accent)' },
  })
  return [plugin, theme]
}
