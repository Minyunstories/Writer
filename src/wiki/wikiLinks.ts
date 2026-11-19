import { type EditorState, type Extension, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, hoverTooltip, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { buildMatcher, type Matcher } from './linker'
import { previewTooltip, type PreviewSource } from './wikiPreview'

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
export function createWikiLinks(options: {
  onOpen: (entryId: string) => void
  /** A card when the mouse rests on a name (no hover on touch screens, so no card there). */
  preview?: PreviewSource
}): {
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

  const preview = options.preview
    ? hoverTooltip((view, pos, side) => previewTooltip(view.state, pos, side, view.state.field(matcherField), options.preview!), { hoverTime: 400 })
    : []

  const theme = EditorView.baseTheme({
    '.cm-mw-link': {
      textDecoration: 'underline',
      textDecorationColor: 'var(--link-line)',
      textDecorationThickness: '1px',
      textUnderlineOffset: '0.22em',
      cursor: 'pointer',
    },
    '.cm-mw-link:hover': { textDecorationColor: 'var(--accent)', color: 'var(--accent)' },
    '.cm-tooltip:has(> .cm-mw-preview)': {
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      boxShadow: '0 12px 30px rgba(0, 0, 0, 0.45)',
      color: 'var(--text)',
    },
    '.cm-mw-preview': {
      display: 'flex',
      gap: '0.75rem',
      alignItems: 'flex-start',
      maxWidth: '20rem',
      padding: '0.7rem 0.8rem',
      fontFamily: 'var(--font-ui)',
      fontSize: '13px',
      lineHeight: '1.4',
    },
    '.cm-mw-preview-portrait': { width: '64px', height: '64px', flex: 'none', borderRadius: '50%', objectFit: 'cover' },
    '.cm-mw-preview-text': { minWidth: '0' },
    '.cm-mw-preview-name': { fontFamily: 'var(--font-display)', fontSize: '1.15rem', lineHeight: '1.25' },
    '.cm-mw-preview-aliases': { color: 'var(--text-muted)', marginTop: '0.1rem' },
    '.cm-mw-preview-properties': {
      display: 'grid',
      gridTemplateColumns: 'auto minmax(0, 1fr)',
      gap: '0.15rem 0.6rem',
      margin: '0.45rem 0 0',
    },
    '.cm-mw-preview-properties dt': { color: 'var(--text-muted)' },
    '.cm-mw-preview-properties dd': { margin: '0', overflowWrap: 'anywhere' },
  })

  return {
    extension: [matcherField, plugin, clicks, preview, theme],
    setMatcher(matcher) {
      latest = matcher
      for (const view of views) view.dispatch({ effects: setMatcherEffect.of(matcher) })
    },
  }
}
