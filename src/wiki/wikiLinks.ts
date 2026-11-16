import { type EditorState, type Extension, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { buildMatcher, type Matcher } from './linker'

/** Link decorations for every known name inside the given ranges. */
export function buildLinkDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  matcher: Matcher,
): DecorationSet {
  if (matcher.size === 0) return Decoration.none
  const found: Range<Decoration>[] = []
  for (const { from, to } of ranges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      for (const match of matcher.find(line.text, line.from)) {
        if (match.to < from || match.from > to) continue
        found.push(
          Decoration.mark({
            class: 'cm-mw-link',
            attributes: { 'data-entry-id': match.entryId },
          }).range(match.from, match.to),
        )
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(found, true)
}

/**
 * Shows wiki names as links. The text itself is never changed.
 * `setMatcher` updates every open editor that uses the extension.
 */
export function createWikiLinks(options: { onOpen: (entryId: string) => void }): {
  extension: Extension
  setMatcher(matcher: Matcher): void
} {
  let latest: Matcher = buildMatcher([])
  const views = new Set<EditorView>()
  const setMatcherEffect = StateEffect.define<Matcher>()

  const matcherField = StateField.define<Matcher>({
    create: () => latest,
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setMatcherEffect)) return effect.value
      }
      return value
    },
  })

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(readonly view: EditorView) {
        views.add(view)
        this.decorations = buildLinkDecorations(view.state, view.visibleRanges, view.state.field(matcherField))
      }

      update(update: ViewUpdate) {
        const matcherChanged = update.startState.field(matcherField) !== update.state.field(matcherField)
        if (update.docChanged || update.viewportChanged || matcherChanged) {
          this.decorations = buildLinkDecorations(
            update.state,
            update.view.visibleRanges,
            update.state.field(matcherField),
          )
        }
      }

      destroy() {
        views.delete(this.view)
      }
    },
    { decorations: (instance) => instance.decorations },
  )

  const linkTarget = (event: Event) =>
    (event.target instanceof Element ? event.target.closest('.cm-mw-link') : null)?.getAttribute('data-entry-id') ??
    null

  let touchMoved = false

  const clicks = EditorView.domEventHandlers({
    // Touch: a tap on a name opens the entry and keeps the keyboard closed, so the
    // sheet is not squeezed above it. To edit a name, tap next to it and move the cursor.
    touchstart() {
      touchMoved = false
      return false
    },
    touchmove() {
      touchMoved = true
      return false
    },
    touchend(event, view) {
      const entryId = touchMoved ? null : linkTarget(event)
      if (!entryId) return false
      event.preventDefault()
      view.contentDOM.blur()
      options.onOpen(entryId)
      return true
    },
    click(event) {
      const entryId = linkTarget(event)
      if (entryId) options.onOpen(entryId)
      // Not handled on purpose: the cursor is still placed where the writer clicked.
      return false
    },
  })

  const theme = EditorView.baseTheme({
    '.cm-mw-link': {
      textDecoration: 'underline',
      textDecorationColor: 'rgba(143, 167, 255, 0.55)',
      textDecorationThickness: '1px',
      textUnderlineOffset: '0.22em',
      cursor: 'pointer',
    },
    '.cm-mw-link:hover': { textDecorationColor: 'var(--accent)', color: 'var(--accent)' },
  })

  return {
    extension: [matcherField, plugin, clicks, theme],
    setMatcher(matcher) {
      latest = matcher
      for (const view of views) view.dispatch({ effects: setMatcherEffect.of(matcher) })
    },
  }
}
