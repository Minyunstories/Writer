import { autocompletion, type Completion, type CompletionSource, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { WikiEntry, WikiFolder } from '../types'

export interface WikiCompletionOptions {
  entries(): WikiEntry[]
  /** Folders offered for new entries (the top-level ones). */
  topFolders(): WikiFolder[]
  create(name: string, folderId: string | null): Promise<void>
}

const OPEN = /\[\[[^[\]\n]*$/
const MAX_OPTIONS = 30
/** Longer than this after "[[" is ordinary writing, not a name: the list closes. */
const MAX_QUERY = 40
/** Names have at most this many words and no sentence punctuation; only those may be created. */
const MAX_NAME_WORDS = 4
const SENTENCE = /[.,;:!?"„“”]/

const looksLikeName = (query: string) => query.split(/\s+/).length <= MAX_NAME_WORDS && !SENTENCE.test(query)

/** Replaces "[[query" (and a "]]" right after it) with the name, cursor behind it. */
function insertName(view: EditorView, from: number, to: number, name: string) {
  const end = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to
  view.dispatch({
    changes: { from, to: end, insert: name },
    selection: { anchor: from + name.length },
    userEvent: 'input.complete',
  })
}

const exists = (entries: WikiEntry[], name: string) =>
  entries.some((entry) => entry.name === name || entry.aliases.includes(name))

/**
 * After "[[": matching entries, then "create" choices for the typed name. Text that reads like
 * a sentence (an unclosed "[[" while writing on) offers no "create" choices.
 */
export function wikiCompletionSource(options: WikiCompletionOptions) {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(OPEN)
    if (!before) return null
    const query = before.text.slice(2).trim()
    if (query.length > MAX_QUERY) return null
    const lower = query.toLocaleLowerCase('de')
    const entries = options.entries()

    const found = entries
      .filter(
        (entry) =>
          !query ||
          entry.name.toLocaleLowerCase('de').includes(lower) ||
          entry.aliases.some((alias) => alias.toLocaleLowerCase('de').includes(lower)),
      )
      .sort((a, b) => {
        // Names starting with the query first.
        const starts = (entry: WikiEntry) => (entry.name.toLocaleLowerCase('de').startsWith(lower) ? 0 : 1)
        return starts(a) - starts(b) || a.name.localeCompare(b.name, 'de')
      })
      .slice(0, MAX_OPTIONS)

    const choices: Completion[] = found.map((entry) => ({
      label: entry.name,
      type: 'wiki-entry',
      apply: (view, _completion, from, to) => insertName(view, from, to, entry.name),
    }))

    if (query && looksLikeName(query) && !exists(entries, query)) {
      const create = (folderId: string | null): Completion['apply'] => (view, _completion, from, to) => {
        insertName(view, from, to, query)
        void options.create(query, folderId)
      }
      for (const folder of options.topFolders()) {
        choices.push({ label: `„${query}" neu anlegen in: ${folder.name}`, type: 'wiki-new', apply: create(folder.id) })
      }
      choices.push({ label: `„${query}" neu anlegen ohne Ordner`, type: 'wiki-new', apply: create(null) })
    }

    return choices.length > 0 ? { from: before.from, options: choices, filter: false } : null
  }
}

/**
 * Typing the second "]" of "[[Name]]" turns it into the plain name.
 * A name without an entry gets one, without a folder. Returns true when it handled the input.
 */
export function closeWikiBrackets(view: EditorView, from: number, to: number, text: string, options: WikiCompletionOptions): boolean {
  if (text !== ']' || from !== to) return false
  const line = view.state.doc.lineAt(from)
  const match = /\[\[([^[\]\n]+)\]$/.exec(view.state.sliceDoc(line.from, from))
  if (!match) return false
  const name = match[1].trim()
  if (!name) return false
  const start = from - match[0].length
  view.dispatch({ changes: { from: start, to, insert: name }, selection: { anchor: start + name.length }, userEvent: 'input' })
  if (!exists(options.entries(), name)) void options.create(name, null)
  return true
}

/** "[[" while writing: link an entry or create a new one. */
export function wikiCompletion(options: WikiCompletionOptions, moreSources: CompletionSource[] = []): Extension {
  return [
    // Nothing is picked until the writer picks it, so Enter after an unclosed "[[" keeps writing.
    autocompletion({ override: [wikiCompletionSource(options), ...moreSources], icons: false, activateOnTyping: true, selectOnOpen: false }),
    EditorView.inputHandler.of((view, from, to, text) => closeWikiBrackets(view, from, to, text, options)),
  ]
}
