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
      { backgroundColor: 'rgba(143, 167, 255, 0.28)' },
    '.cm-mw-h1': { fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3' },
    '.cm-mw-h2': { fontSize: '1.4em', fontWeight: '700', lineHeight: '1.3' },
    '.cm-mw-h3': { fontSize: '1.18em', fontWeight: '700', lineHeight: '1.4' },
    // Half a line between paragraphs instead of a full empty line.
    '.cm-mw-blank': { lineHeight: '0.85' },
    '.cm-mw-bold': { fontWeight: '700' },
    '.cm-mw-italic': { fontStyle: 'italic' },
    '.cm-mw-mark': { color: 'var(--text-muted)', opacity: '0.45', fontWeight: '400', fontStyle: 'normal' },
  },
  { dark: true },
)
