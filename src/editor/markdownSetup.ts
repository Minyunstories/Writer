import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, type Extension } from '@codemirror/state'
import { keymap, type Command, type KeyBinding } from '@codemirror/view'
import type { MarkdownConfig } from '@lezer/markdown'
import { livePreview } from './livePreview'

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }
const PUNCTUATION = /[\p{P}\p{S}]/u

/**
 * ==highlighted text==, parsed like GFM strikethrough: the markers must hug the text,
 * so "a == b" or a lone "==" stay plain text.
 */
export const highlightSyntax: MarkdownConfig = {
  defineNodes: [{ name: 'Highlight' }, { name: 'HighlightMark' }],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1
        const before = cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3)
        const spaceBefore = /\s|^$/.test(before)
        const spaceAfter = /\s|^$/.test(after)
        const punctBefore = PUNCTUATION.test(before)
        const punctAfter = PUNCTUATION.test(after)
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
        )
      },
      after: 'Emphasis',
    },
  ],
}

/** Wraps the selection in a marker such as **, * or ==, or removes it again. */
export function toggleWrap(mark: string): Command {
  return (view) => {
    const { state } = view
    const changes = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - mark.length, range.from)
      const after = state.sliceDoc(range.to, range.to + mark.length)
      if (before === mark && after === mark) {
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + mark.length },
          ],
          range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
        }
      }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      }
    })
    view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

export const toggleHighlight = toggleWrap('==')

/** Bold, italic and highlight shortcuts, shared by the chapter editor and every note field. */
export const formatKeys: KeyBinding[] = [
  { key: 'Mod-b', run: toggleWrap('**') },
  { key: 'Mod-i', run: toggleWrap('*') },
  { key: 'Mod-Shift-h', run: toggleHighlight },
]

/** Markdown with highlights, live formatting and the format shortcuts. */
export function writingMarkdown(): Extension {
  return [keymap.of(formatKeys), markdown({ addKeymap: false, extensions: [highlightSyntax] }), livePreview()]
}
