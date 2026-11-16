import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

const headingLine = [1, 2, 3].map((level) => Decoration.line({ class: `cm-mw-h${level}` }))
const bold = Decoration.mark({ class: 'cm-mw-bold' })
const italic = Decoration.mark({ class: 'cm-mw-italic' })
const marker = Decoration.mark({ class: 'cm-mw-mark' })
const highlight = Decoration.mark({ class: 'cm-mw-highlight' })
const blankLine = Decoration.line({ class: 'cm-mw-blank' })

const HEADING = /^(?:ATXHeading|SetextHeading)(\d)$/

/** Decorations for headings, bold, italic and empty lines inside the given ranges. */
export function buildDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const found: Range<Decoration>[] = []
  const end = ranges.reduce((max, range) => Math.max(max, range.to), 0)
  const tree = ensureSyntaxTree(state, end, 50) ?? syntaxTree(state)

  for (const { from, to } of ranges) {
    // Empty lines separate paragraphs; they are drawn at reduced height.
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      if (line.length === 0) found.push(blankLine.range(line.from))
      pos = line.to + 1
    }
    tree.iterate({
      from,
      to,
      enter(node) {
        const heading = HEADING.exec(node.name)
        if (heading) {
          const level = Math.min(Number(heading[1]), 3)
          found.push(headingLine[level - 1].range(state.doc.lineAt(node.from).from))
        } else if (node.name === 'StrongEmphasis') {
          found.push(bold.range(node.from, node.to))
        } else if (node.name === 'Emphasis') {
          found.push(italic.range(node.from, node.to))
        } else if (node.name === 'Highlight') {
          found.push(highlight.range(node.from, node.to))
        } else if (node.name === 'HeaderMark' || node.name === 'EmphasisMark' || node.name === 'HighlightMark') {
          if (node.to > node.from) found.push(marker.range(node.from, node.to))
        }
      },
    })
  }
  return Decoration.set(found, true)
}

export function livePreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view.state, view.visibleRanges)
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = buildDecorations(update.view.state, update.view.visibleRanges)
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}
