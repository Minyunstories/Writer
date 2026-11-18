// Builds public/thesaurus.json from WordNet (wordnet-db): English synonyms grouped by meaning,
// read offline by the app. Run before dev and build; the result is not committed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_MEANING = 80

/** One WordNet data file → [pos, meaning, ...words] for every meaning with at least two words. */
export function parseData(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!/^\d{8} /.test(line)) continue
    const [head, gloss = ''] = line.split(' | ')
    const parts = head.split(' ')
    const pos = parts[2] === 's' ? 'a' : parts[2]
    const count = parseInt(parts[3], 16)
    const words = []
    for (let i = 0; i < count; i++) {
      const word = parts[4 + i * 2].replace(/\(.*\)$/, '').replace(/_/g, ' ')
      if (!words.includes(word)) words.push(word)
    }
    if (words.length < 2) continue
    let meaning = gloss.split(';')[0].trim()
    if (meaning.length > MAX_MEANING) meaning = `${meaning.slice(0, MAX_MEANING - 1).trimEnd()}…`
    out.push([pos, meaning, ...words])
  }
  return out
}

export function buildThesaurus(dictDir) {
  const s = []
  for (const file of ['data.verb', 'data.noun', 'data.adj', 'data.adv'])
    s.push(...parseData(readFileSync(join(dictDir, file), 'utf8')))
  const w = Object.create(null)
  s.forEach((entry, index) => {
    for (const word of entry.slice(2)) (w[word.toLowerCase()] ??= []).push(index)
  })
  return { s, w }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const target = join(root, 'public', 'thesaurus.json')
  if (!existsSync(target) || process.argv.includes('--force')) {
    const dict = join(root, 'node_modules', 'wordnet-db', 'dict')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify(buildThesaurus(dict)))
  }
}
