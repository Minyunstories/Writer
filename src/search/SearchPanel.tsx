import { separateParagraphs } from '../editor/paragraphs'
import { typographic } from '../editor/typography'
import { useMemo, useState } from 'react'
import type { Chapter } from '../types'
import { findMatches, type FindOptions } from './find'
import './search.css'

interface Props {
  chapters: Chapter[]
  onOpen: (chapterId: string, range: { from: number; to: number }) => void
  /** Replaces in every chapter; resolves to the number of replaced places. */
  onReplaceAll: (query: string, replacement: string, options: FindOptions) => Promise<number>
  /** Curly quotes and dashes in every chapter; resolves to the number of changed chapters. */
  onTypography?: () => Promise<number>
  /** A blank line between paragraphs in every chapter; resolves to the number of changed chapters. */
  onParagraphs?: () => Promise<number>
  onClose: () => void
}

const CONTEXT = 40

/** Search through every chapter of the book, and replace everywhere at once. */
export function SearchPanel({ chapters, onOpen, onReplaceAll, onTypography, onParagraphs, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [replaced, setReplaced] = useState<number | null>(null)
  const [typoConfirm, setTypoConfirm] = useState(false)
  const [typoDone, setTypoDone] = useState<number | null>(null)
  const typoCount = useMemo(() => (typoConfirm ? chapters.filter((chapter) => typographic(chapter.content) !== chapter.content).length : 0), [chapters, typoConfirm])
  const [paraConfirm, setParaConfirm] = useState(false)
  const [paraDone, setParaDone] = useState<number | null>(null)
  const paraCount = useMemo(() => (paraConfirm ? chapters.filter((chapter) => separateParagraphs(chapter.content).text !== chapter.content).length : 0), [chapters, paraConfirm])
  const options = { caseSensitive, wholeWord }

  const groups = useMemo(
    () =>
      chapters
        .map((chapter) => ({ chapter, matches: findMatches(chapter.content, query, { caseSensitive, wholeWord }) }))
        .filter((group) => group.matches.length > 0),
    [chapters, query, caseSensitive, wholeWord],
  )
  const total = groups.reduce((sum, group) => sum + group.matches.length, 0)

  const changeQuery = (value: string) => {
    setQuery(value)
    setConfirming(false)
    setReplaced(null)
  }

  return (
    <aside className="book-panel search-panel" aria-label="Suchen und Ersetzen">
      <header className="book-panel-header">
        <span className="notes-title">Suchen</span>
        <button className="ghost" onClick={onClose}>
          Schließen
        </button>
      </header>
      <div className="book-panel-body search-body">
        <input
          type="search"
          aria-label="Suchen nach"
          placeholder="Suchen im ganzen Buch …"
          value={query}
          autoFocus
          onChange={(event) => changeQuery(event.target.value)}
        />
        <div className="search-options">
          <label>
            <input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /> Groß/klein beachten
          </label>
          <label>
            <input type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} /> Ganze Wörter
          </label>
        </div>
        <input type="text" aria-label="Ersetzen durch" placeholder="Ersetzen durch …" value={replacement} onChange={(event) => setReplacement(event.target.value)} />
        {total > 0 &&
          (confirming ? (
            <div className="search-confirm">
              <span>
                {total} {total === 1 ? 'Stelle' : 'Stellen'} durch „{replacement}“ ersetzen?
              </span>
              <button
                className="primary"
                onClick={async () => {
                  setConfirming(false)
                  setReplaced(await onReplaceAll(query, replacement, options))
                }}
              >
                Ja, ersetzen
              </button>
              <button className="ghost" onClick={() => setConfirming(false)}>
                Abbrechen
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)}>Alle ersetzen</button>
          ))}
        {replaced !== null && <p className="search-summary">{replaced === 1 ? '1 Stelle ersetzt.' : `${replaced} Stellen ersetzt.`}</p>}

        {query && (
          <p className="search-summary">
            {total === 0
              ? 'Keine Treffer.'
              : `${total} Treffer in ${groups.length} ${groups.length === 1 ? 'Kapitel' : 'Kapiteln'}`}
          </p>
        )}
        {total > 0 && (
          <ul className="search-results" aria-label="Fundstellen">
            {groups.map(({ chapter, matches }) => (
              <li key={chapter.id}>
                <h3>{chapter.title}</h3>
                <ul>
                  {matches.map((match) => {
                    const before = chapter.content.slice(Math.max(0, match.from - CONTEXT), match.from)
                    const after = chapter.content.slice(match.to, match.to + CONTEXT)
                    return (
                      <li key={match.from}>
                        <button className="search-hit" onClick={() => onOpen(chapter.id, match)}>
                          {match.from > CONTEXT && '…'}
                          {before.replace(/\n/g, ' ')}
                          <mark>{chapter.content.slice(match.from, match.to)}</mark>
                          {after.replace(/\n/g, ' ')}…
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}

        {onTypography && !query && (
          <section className="search-typography">
            <h3>Typografie</h3>
            <p className="muted">Gerade Anführungszeichen werden zu “ ” und ‘ ’, ein Bindestrich zwischen Leerzeichen zu –, zwei Bindestriche zu —. Die Leerzeichen bleiben.</p>
            {typoConfirm ? (
              typoCount === 0 ? (
                <p className="search-summary">Alles schon umgewandelt.</p>
              ) : (
                <div className="search-confirm">
                  <span>{typoCount} Kapitel umwandeln? Vorher wird jeweils eine Fassung gesichert.</span>
                  <button
                    className="primary"
                    onClick={async () => {
                      setTypoConfirm(false)
                      setTypoDone(await onTypography())
                    }}
                  >
                    Ja, umwandeln
                  </button>
                  <button className="ghost" onClick={() => setTypoConfirm(false)}>
                    Abbrechen
                  </button>
                </div>
              )
            ) : (
              <button
                onClick={() => {
                  setTypoDone(null)
                  setTypoConfirm(true)
                }}
              >
                Anführungszeichen und Striche umwandeln
              </button>
            )}
            {typoDone !== null && <p className="search-summary">{typoDone} Kapitel umgewandelt.</p>}
          </section>
        )}

        {onParagraphs && !query && (
          <section className="search-typography">
            <h3>Absätze</h3>
            <p className="muted">Wo zwei Textzeilen direkt untereinander stehen, kommt eine Leerzeile dazwischen.</p>
            {paraConfirm ? (
              paraCount === 0 ? (
                <p className="search-summary">Alles schon getrennt.</p>
              ) : (
                <div className="search-confirm">
                  <span>{paraCount} Kapitel ändern? Vorher wird jeweils eine Fassung gesichert.</span>
                  <button
                    className="primary"
                    onClick={async () => {
                      setParaConfirm(false)
                      setParaDone(await onParagraphs())
                    }}
                  >
                    Ja, trennen
                  </button>
                  <button className="ghost" autoFocus onClick={() => setParaConfirm(false)}>
                    Abbrechen
                  </button>
                </div>
              )
            ) : (
              <button
                onClick={() => {
                  setParaDone(null)
                  setParaConfirm(true)
                }}
              >
                Absätze trennen
              </button>
            )}
            {paraDone !== null && <p className="search-summary">{paraDone} Kapitel geändert.</p>}
          </section>
        )}
      </div>
    </aside>
  )
}
