import { EditorSelection, EditorState } from '@codemirror/state'

/**
 * Paragraphs that lost their blank lines (pasted from elsewhere): a blank line wherever two lines with text meet.
 * A line of spaces counts as blank; blank lines that are there stay as they are. Line breaks may be \r\n or \r
 * (the clipboard on Windows); the result only has \n. `added` holds the places in the text (after turning \r\n
 * into \n) where a line break went in, right behind the one that was there.
 */
export function separateParagraphs(text: string): { text: string; added: number[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const added: number[] = []
  let offset = 0
  let out = lines[0]
  for (let index = 1; index < lines.length; index++) {
    offset += lines[index - 1].length + 1
    if (lines[index - 1].trim() && lines[index].trim()) {
      added.push(offset)
      out += '\n'
    }
    out += '\n' + lines[index]
  }
  return { text: out, added }
}

/** Where a place in the old text is after the line breaks in `added` went in. */
export function mapPosition(added: number[], pos: number): number {
  let shift = 0
  for (const at of added) if (at <= pos) shift++
  return pos + shift
}

/** Has the line any text (a line of spaces counts as blank)? */
const hasText = (line: string) => line.trim() !== ''

/**
 * What to insert instead of `text` between `from` and `to` so that wherever two lines with text meet, a blank line
 * is between them. The rest of the line around the cursor counts too (a line break the text starts or ends with
 * gets its blank line), and so do the lines next to a blank line the text lands on. Text without line breaks at
 * its edges that lands in a paragraph leaves that paragraph whole; the existing text is never changed.
 */
function separatedInsert(state: EditorState, from: number, to: number, text: string): string {
  const fromLine = state.doc.lineAt(from)
  const toLine = state.doc.lineAt(to)
  const before = state.sliceDoc(fromLine.from, from)
  const after = state.sliceDoc(to, toLine.to)
  const separated = separateParagraphs(before + text + after).text
  const lines = separated.split('\n')
  let insert = separated.slice(before.length, separated.length - after.length)
  if (!hasText(fromLine.text) && fromLine.number > 1 && hasText(state.doc.line(fromLine.number - 1).text) && hasText(lines[0])) insert = '\n' + insert
  if (!hasText(toLine.text) && toLine.number < state.doc.lines && hasText(state.doc.line(toLine.number + 1).text) && hasText(lines[lines.length - 1])) insert += '\n'
  return insert
}

/**
 * Text pasted into a chapter keeps its paragraphs apart (see `separatedInsert`). Only pasting: text moved by
 * dragging and typing stay as they are. The paste stays one step for Strg+Z.
 */
export const pasteParagraphs = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input.paste')) return tr
  const specs: { from: number; to: number; insert: string }[] = []
  let changed = false
  // A cursor right after the pasted text stays right after it, before a blank line added behind it.
  let endB = -1
  let endShift = 0
  tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
    const text = inserted.toString()
    const insert = separatedInsert(tr.startState, fromA, toA, text)
    if (insert !== text) changed = true
    specs.push({ from: fromA, to: toA, insert })
    endB = toB
    endShift = insert.endsWith('\n') && !text.endsWith('\n') ? 1 : 0
  })
  if (!changed) return tr
  const changes = tr.startState.changes(specs)
  let selection = tr.selection && tr.selection.map(tr.changes.invertedDesc, 1).map(changes, 1)
  if (selection && tr.selection!.ranges.length === 1 && tr.selection!.main.empty && tr.selection!.main.head === endB)
    selection = EditorSelection.single(selection.main.head - endShift)
  return { changes, selection, userEvent: 'input.paste', scrollIntoView: tr.scrollIntoView }
})
