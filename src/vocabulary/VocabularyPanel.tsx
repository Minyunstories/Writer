import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { addWord, deleteWord, setLearner, updateWord } from '../storage/vocabulary'
import type { Book, Chapter, VocabWord, WikiEntry } from '../types'
import { ConfirmDialog } from '../ui/Dialogs'
import { activeLearners, normalize, searchWords, wordState } from './knowledge'
import './vocabulary.css'

interface Props {
  book: Book
  entries: WikiEntry[]
  chapters: Chapter[]
  /** The chapter open in the editor. */
  chapterId: string
  /** Wiki entries that appear in the open chapter, in order of appearance. */
  mentioned: string[]
  /** The learner whose eyes the list is seen through; '' for all words. */
  viewer: string
  onViewer: (entryId: string) => void
  /** Opens a word (or, with null, an empty new row); a new key repeats the request. */
  editing?: { wordId: string | null; key: number }
  onChanged: () => void
}

type Knower = { entryId: string; chapterId: string }
interface Draft {
  id: string | null
  word: string
  translation: string
  note: string
  known: Knower[]
  /** Figures added while editing: shown even before they are learners. */
  added: string[]
}

const ADD_LEARNER = '__add'
const EMPTY = 'Noch keine Wörter. Markiere ein Wort im Text und drücke Strg+Umschalt+L, oder lege es mit „+ Neues Wort“ an.'

/** The vocabulary module in the drawer: the word list, who knows what, and editing. */
export function VocabularyPanel({ book, entries, chapters, chapterId, mentioned, viewer, onViewer, editing, onChanged }: Props) {
  const allWords = book.vocabulary?.words ?? []
  const learners = activeLearners(book.vocabulary, entries)
  const learnerIds = new Set(learners.map((learner) => learner.id))
  // A remembered figure who is no longer learning (or no longer exists): show all words.
  const shownViewer = learnerIds.has(viewer) ? viewer : ''
  const chapterOrder = chapters.map((chapter) => chapter.id)
  const titleOf = (id: string) => chapters.find((chapter) => chapter.id === id)?.title
  const nameOf = (id: string) => entries.find((entry) => entry.id === id)?.name ?? ''

  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [focus, setFocus] = useState<'word' | 'translation' | null>(null)
  const [wordMissing, setWordMissing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState(false)
  const wordRef = useRef<HTMLInputElement>(null)
  const translationRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const openNew = () => {
    setDraft({ id: null, word: '', translation: '', note: '', known: shownViewer ? [{ entryId: shownViewer, chapterId }] : [], added: [] })
    setWordMissing(false)
    setFocus('word')
  }
  const openWord = (word: VocabWord, focusOn: 'word' | 'translation' = 'word') => {
    // A word the search hides could not show its form: clear the search.
    if (!searchWords([word], query).length) setQuery('')
    setDraft({
      id: word.id,
      word: word.word,
      translation: word.translation,
      note: word.note ?? '',
      known: word.known.map(({ entryId, chapterId: from }) => ({ entryId, chapterId: from })),
      added: [],
    })
    setWordMissing(false)
    setFocus(focusOn)
  }

  // A request from outside, e.g. a word just taken from the text. Waits until the word has arrived.
  const handled = useRef<number | null>(null)
  useEffect(() => {
    if (!editing || handled.current === editing.key) return
    if (editing.wordId === null) {
      handled.current = editing.key
      openNew()
      return
    }
    const word = allWords.find((item) => item.id === editing.wordId)
    if (!word) return
    handled.current = editing.key
    openWord(word, 'translation')
    // Only a new request or newly arrived words matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, allWords])

  useEffect(() => {
    if (!focus) return
    // The drawer is short: show the whole form, not just the field with the cursor.
    formRef.current?.scrollIntoView?.({ block: 'start' })
    if (focus === 'word') wordRef.current?.focus({ preventScroll: true })
    else translationRef.current?.focus({ preventScroll: true })
    setFocus(null)
  }, [focus])

  const attempt = async (action: () => Promise<unknown>) => {
    setFailed(false)
    try {
      await action()
      return true
    } catch {
      setFailed(true)
      return false
    } finally {
      onChanged()
    }
  }

  const save = async () => {
    if (!draft) return
    if (!draft.word.trim()) {
      setWordMissing(true)
      wordRef.current?.focus()
      return
    }
    const fields = { word: draft.word, translation: draft.translation, note: draft.note, known: draft.known }
    const done = await attempt(() => (draft.id ? updateWord(book.id, draft.id, fields) : addWord(book.id, fields)))
    if (done) setDraft(null)
  }
  const remove = async () => {
    setConfirming(false)
    if (!draft?.id) return
    const id = draft.id
    if (await attempt(() => deleteWord(book.id, id))) setDraft(null)
  }
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(null)
    }
  }

  const chooseViewer = (value: string) => {
    if (value === ADD_LEARNER) setPicking(true)
    else {
      setPicking(false)
      onViewer(value)
    }
  }
  const addLearner = async (entryId: string) => {
    if (!entryId) return
    setPicking(false)
    if (await attempt(() => setLearner(book.id, entryId, true))) onViewer(entryId)
  }
  const stopLearning = async () => {
    const entryId = shownViewer
    onViewer('')
    await attempt(() => setLearner(book.id, entryId, false))
  }

  /** Wiki entries that are not learners: those in this chapter first, then the rest by name. */
  const others = (exclude: Set<string>) => {
    const here = mentioned.flatMap((id) => entries.find((entry) => entry.id === id && !learnerIds.has(id) && !exclude.has(id)) ?? [])
    const hereIds = new Set(here.map((entry) => entry.id))
    const rest = entries.filter((entry) => !learnerIds.has(entry.id) && !hereIds.has(entry.id) && !exclude.has(entry.id)).sort((a, b) => a.name.localeCompare(b.name))
    return { here, rest }
  }

  const visible = searchWords(allWords, query)
  const duplicate = draft && draft.word.trim() ? allWords.find((word) => word.id !== draft.id && normalize(word.word) === normalize(draft.word)) : undefined

  const hintOf = (word: VocabWord): string | null => {
    if (!shownViewer) return null
    const state = wordState(word, shownViewer, chapterOrder, chapterId)
    if (state.kind === 'later') return `ab ${titleOf(state.chapterId) ?? ''}`
    if (state.kind === 'unknown') return 'noch nicht gelernt'
    if (state.kind === 'chapterGone') return 'Kapitel gelöscht'
    return null
  }

  const renderForm = (current: Draft) => {
    const shown = current.known.filter((item) => learnerIds.has(item.entryId) || current.added.includes(item.entryId))
    const listed = new Set(current.known.map((item) => item.entryId))
    const freeLearners = learners.filter((learner) => !listed.has(learner.id))
    const { here, rest } = others(listed)
    const update = (patch: Partial<Draft>) => setDraft({ ...current, ...patch })
    return (
      <div ref={formRef} className="vocab-form" role="group" aria-label={current.id ? 'Wort bearbeiten' : 'Neues Wort'}>
        <label className="vocab-field">
          Wort
          <input ref={wordRef} value={current.word} onChange={(event) => update({ word: event.target.value })} onKeyDown={onFieldKey} />
        </label>
        <label className="vocab-field">
          Übersetzung
          <input ref={translationRef} value={current.translation} onChange={(event) => update({ translation: event.target.value })} onKeyDown={onFieldKey} />
        </label>
        {wordMissing && !current.word.trim() && <p className="vocab-error">Bitte ein Wort eingeben.</p>}
        {duplicate && (
          <p className="vocab-duplicate">
            Gibt es schon
            <button type="button" className="ghost" onClick={() => openWord(duplicate)}>
              Zeigen
            </button>
          </p>
        )}
        <label className="vocab-field">
          Notiz
          <input value={current.note} onChange={(event) => update({ note: event.target.value })} onKeyDown={onFieldKey} />
        </label>
        <fieldset className="vocab-who">
          <legend>Wer kennt es</legend>
          {shown.map((item) => {
            const name = nameOf(item.entryId)
            return (
              <div key={item.entryId} className="vocab-knower">
                <span className="vocab-knower-name">{name}</span>
                <select
                  aria-label={`Ab Kapitel für ${name}`}
                  value={item.chapterId}
                  onChange={(event) =>
                    update({ known: current.known.map((known) => (known.entryId === item.entryId ? { ...known, chapterId: event.target.value } : known)) })
                  }
                >
                  {!titleOf(item.chapterId) && <option value={item.chapterId}>Kapitel gelöscht</option>}
                  {chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ghost icon"
                  aria-label={`${name} entfernen`}
                  onClick={() => update({ known: current.known.filter((known) => known.entryId !== item.entryId) })}
                >
                  ×
                </button>
              </div>
            )
          })}
          <select
            aria-label="Figur hinzufügen"
            value=""
            onChange={(event) => {
              const entryId = event.target.value
              if (entryId) update({ known: [...current.known, { entryId, chapterId }], added: [...current.added, entryId] })
            }}
          >
            <option value="">Figur hinzufügen …</option>
            {freeLearners.length > 0 && (
              <optgroup label="Lernende">
                {freeLearners.map((learner) => (
                  <option key={learner.id} value={learner.id}>
                    {learner.name}
                  </option>
                ))}
              </optgroup>
            )}
            {here.length + rest.length > 0 && (
              <optgroup label="Andere Figur …">
                {[...here, ...rest].map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </fieldset>
        <div className="vocab-actions">
          <button type="button" className="primary" onClick={() => void save()}>
            Fertig
          </button>
          <button type="button" className="ghost" onClick={() => setDraft(null)}>
            Abbrechen
          </button>
          {current.id && (
            <button type="button" className="ghost danger vocab-delete" onClick={() => setConfirming(true)}>
              Löschen
            </button>
          )}
        </div>
      </div>
    )
  }

  const { here: pickHere, rest: pickRest } = others(new Set())

  return (
    <div className="vocab">
      <div className="vocab-bar">
        <input type="search" className="vocab-search" aria-label="Suchen" placeholder="Suchen" value={query} onChange={(event) => setQuery(event.target.value)} />
        <label className="vocab-viewer">
          Aus Sicht von
          <select value={shownViewer} onChange={(event) => chooseViewer(event.target.value)}>
            <option value="">Alle Wörter</option>
            {learners.map((learner) => (
              <option key={learner.id} value={learner.id}>
                {learner.name}
              </option>
            ))}
            <option value={ADD_LEARNER}>+ Lernende Figur …</option>
          </select>
        </label>
        {shownViewer && (
          <button type="button" className="ghost" onClick={() => void stopLearning()}>
            Nicht mehr lernend
          </button>
        )}
        <span className="vocab-bar-space" />
        <button type="button" className="ghost vocab-new" title="Neues Wort (oder Text markieren und Strg+Umschalt+L)" onClick={openNew}>
          + Neues Wort
        </button>
      </div>

      {picking && (
        <div className="vocab-picker">
          <select aria-label="Lernende Figur" value="" onChange={(event) => void addLearner(event.target.value)}>
            <option value="">Figur wählen …</option>
            {pickHere.length > 0 && (
              <optgroup label="In diesem Kapitel">
                {pickHere.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            )}
            {pickRest.length > 0 && (
              <optgroup label="Weitere">
                {pickRest.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button type="button" className="ghost" onClick={() => setPicking(false)}>
            Abbrechen
          </button>
        </div>
      )}

      {failed && (
        <p className="vocab-error" role="alert">
          Das hat nicht geklappt. Bitte versuche es noch einmal.
        </p>
      )}

      {draft && draft.id === null && renderForm(draft)}

      {allWords.length === 0 ? (
        !draft && <p className="vocab-empty">{EMPTY}</p>
      ) : visible.length === 0 ? (
        <p className="vocab-empty">Nichts gefunden.</p>
      ) : (
        <ul className="vocab-list" aria-label="Wörter">
          {visible.map((word) => {
            if (draft?.id === word.id) return <li key={word.id}>{renderForm(draft)}</li>
            const hint = hintOf(word)
            return (
              <li key={word.id}>
                <button type="button" className={`vocab-row${hint ? ' is-faded' : ''}`} onClick={() => openWord(word)}>
                  <span className="vocab-word">{word.word}</span>
                  <span className="vocab-translation">{word.translation}</span>
                  {(word.note || hint) && (
                    <span className="vocab-meta">
                      {hint && <span className="vocab-hint">{hint}</span>}
                      {word.note && <span className="vocab-note">{word.note}</span>}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {confirming && draft?.id && (
        <ConfirmDialog
          message="Wort löschen?"
          detail={`„${draft.word}“ wird aus dem Vokabelheft entfernt.`}
          confirmLabel="Löschen"
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
