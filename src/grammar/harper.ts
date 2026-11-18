import type { BookSpelling, EnglishDialect } from '../types'
import type { GrammarItem } from './grammarCheck'

type HarperModule = typeof import('harper.js')
type WorkerLinter = InstanceType<HarperModule['WorkerLinter']>

let loading: Promise<{ harper: HarperModule; linter: WorkerLinter }> | null = null
let configured = ''

/** Harper is large; it loads the first time a text is checked, then stays (and works offline). */
function load() {
  if (!loading) {
    loading = (async () => {
      const [harper, { binary }] = await Promise.all([import('harper.js'), import('harper.js/binary')])
      const linter = new harper.WorkerLinter({ binary })
      await linter.setup()
      return { harper, linter }
    })()
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

const DIALECT_NAMES: Record<EnglishDialect, 'American' | 'British' | 'Australian' | 'Canadian'> = {
  american: 'American',
  british: 'British',
  australian: 'Australian',
  canadian: 'Canadian',
}

/** Words the check should know: the book's own list plus every wiki name and alias, word by word. */
export function knownWords(spelling: BookSpelling | undefined, names: string[]): string[] {
  const words = new Set(spelling?.words ?? [])
  for (const name of names) for (const word of name.split(/[^\p{L}\p{N}'’-]+/u)) if (word) words.add(word)
  return [...words].sort()
}

/** Rules off unless the writer wants them: swearing is part of how characters talk. */
let defaultsOff: Promise<string[]> | null = null
function rulesOffByDefault(linter: WorkerLinter): Promise<string[]> {
  if (!defaultsOff)
    defaultsOff = linter
      .getLintDescriptions()
      .then((descriptions) =>
        Object.entries(descriptions)
          .filter(([, text]) => /offensive language|profan|curse|swear/i.test(text))
          .map(([rule]) => rule),
      )
      .catch(() => [])
  return defaultsOff
}

async function configure(spelling: BookSpelling | undefined, words: string[]) {
  const { harper, linter } = await load()
  const key = JSON.stringify([spelling?.dialect ?? 'american', words, spelling?.ignored ?? [], spelling?.rules ?? []])
  if (key === configured) return linter
  const off = new Set([...(await rulesOffByDefault(linter)), ...(spelling?.rules ?? [])])
  const config = await linter.getDefaultLintConfig()
  for (const rule of off) if (rule in config) config[rule] = false
  await linter.setLintConfig(config)
  await linter.setDialect(harper.Dialect[DIALECT_NAMES[spelling?.dialect ?? 'american']])
  await linter.clearWords()
  if (words.length > 0) await linter.importWords(words)
  await linter.clearIgnoredLints()
  for (const hash of spelling?.ignored ?? []) {
    try {
      await linter.ignoreLintHash(BigInt(hash))
    } catch {
      // Not a hash this version understands.
    }
  }
  configured = key
  return linter
}

/** Harper counts characters; JavaScript counts UTF-16 units. Equal unless the text has emoji and the like. */
function positionMap(text: string): (index: number) => number {
  if (!/[\uD800-\uDFFF]/.test(text)) return (index) => index
  const offsets: number[] = []
  let unit = 0
  for (const char of text) {
    offsets.push(unit)
    unit += char.length
  }
  offsets.push(unit)
  return (index) => offsets[Math.min(index, offsets.length - 1)]
}

/** Checks a Markdown text and returns its findings in document positions. */
export async function checkText(text: string, spelling: BookSpelling | undefined, words: string[]): Promise<GrammarItem[]> {
  const linter = await configure(spelling, words)
  const organized = await linter.organizedLints(text, { language: 'markdown' })
  const at = positionMap(text)
  const items: GrammarItem[] = []
  for (const [rule, lints] of Object.entries(organized))
  for (const lint of lints) {
    const span = lint.span()
    const from = at(span.start)
    const to = at(span.end)
    const kind = lint.lint_kind()
    const problem = text.slice(from, to)
    const suggestions = lint.suggestions().map((suggestion) => {
      const replacement = suggestion.get_replacement_text()
      // 0 replace, 1 remove, 2 insert after.
      const kindOf = Number(suggestion.kind())
      const insert = kindOf === 1 ? '' : kindOf === 2 ? `${problem}${replacement}` : replacement
      return { label: insert === '' ? 'Entfernen' : insert, insert }
    })
    let hash: string | undefined
    try {
      hash = (await linter.contextHash(text, lint)).toString()
    } catch {
      hash = undefined
    }
    items.push({
      from,
      to,
      message: lint.message(),
      kind,
      suggestions,
      ...(kind === 'Spelling' ? { word: problem } : {}),
      ...(hash ? { hash } : {}),
      rule,
    })
  }
  return items.sort((a, b) => a.from - b.from)
}
