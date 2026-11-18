import { EditorView } from '@codemirror/view'

export const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--text)',
      fontSize: 'inherit',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: '1.7',
      overflow: 'visible',
    },
    '.cm-content': {
      padding: '0',
      caretColor: 'var(--accent)',
      minHeight: '50vh',
    },
    '.cm-line': { padding: '0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
      { backgroundColor: 'rgba(170, 162, 154, 0.3)' },
    '.cm-mw-h1': { fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3' },
    '.cm-mw-h2': { fontSize: '1.4em', fontWeight: '700', lineHeight: '1.3' },
    '.cm-mw-h3': { fontSize: '1.18em', fontWeight: '700', lineHeight: '1.4' },
    // Half a line between paragraphs instead of a full empty line.
    '.cm-mw-blank': { lineHeight: '0.85' },
    '.cm-mw-flash': { backgroundColor: 'rgba(217, 178, 106, 0.3)', borderRadius: '3px' },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
      fontFamily: 'var(--font-ui)',
      fontSize: '14px',
      overflow: 'hidden',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { maxHeight: '16em', fontFamily: 'var(--font-ui)' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '0.45em 0.8em', color: 'var(--text)' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
    '.cm-completionLabel': { whiteSpace: 'normal' },
    '.cm-mw-bold': { fontWeight: '700' },
    '.cm-mw-italic': { fontStyle: 'italic' },
    // The colour comes from the book (see BookView); copper when no book sets one.
    '.cm-mw-highlight': {
      backgroundColor: 'var(--mw-highlight, rgba(213, 141, 98, 0.30))',
      borderRadius: '3px',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
    },
    // Scene breaks (***) sit in the middle of the column.
    '.cm-mw-separator': {
      textAlign: 'center',
      color: 'var(--text-muted)',
      letterSpacing: '0.4em',
    },
    '.cm-mw-mark': { color: 'var(--text-muted)', opacity: '0.45', fontWeight: '400', fontStyle: 'normal' },
  },
  { dark: true },
)
