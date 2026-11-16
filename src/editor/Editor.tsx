import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { Annotation, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, type Command } from '@codemirror/view'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ZoomControl } from '../book/ZoomControl'
import { countWords } from '../lib/wordCount'
import { useZoom, ZOOM_STEP } from '../lib/zoom'
import { SYNCED_EVENT } from '../storage/connection'
import { createChapter, getChapter, updateBook } from '../storage/db'
import type { Book, Chapter, FontId } from '../types'
import { editorTheme } from './editorTheme'
import { livePreview } from './livePreview'
import { ChapterSaver, type SaveState } from './saver'
import { StatusBar } from './StatusBar'
import './editor.css'

const COUNT_DELAY = 250

/** Marks a change that came from storage, not from the writer. */
const external = Annotation.define<boolean>()

const FONTS: { id: FontId; label: string; family: string }[] = [
  { id: 'literata', label: 'Literata', family: "'Literata', Georgia, serif" },
  { id: 'inter', label: 'Inter', family: "'Inter', system-ui, sans-serif" },
  { id: 'courier-prime', label: 'Courier Prime', family: "'Courier Prime', 'Courier New', monospace" },
]

/** Wraps the selection in a marker such as ** or *, or removes it again. */
function toggleWrap(mark: string): Command {
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

interface Props {
  book: Book
  chapter: Chapter
  /** Called after title, font or the chapter list changed, so the surrounding view can refresh. */
  onChanged: () => void
  /** Hook for later stages, e.g. wiki links. */
  extraExtensions?: Extension[]
}

export function Editor({ book, chapter, onChanged, extraExtensions }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saverRef = useRef<ChapterSaver | null>(null)
  const countTimer = useRef<number>()
  const titleRef = useRef(chapter.title)
  const titleDirty = useRef(false)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  const [title, setTitleState] = useState(chapter.title)
  const [font, setFont] = useState<FontId>(book.font)
  const [words, setWords] = useState(() => countWords(chapter.content))
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [loadError, setLoadError] = useState(false)
  const [zoom, setZoom] = useZoom('editor')

  const setTitle = (value: string) => {
    titleRef.current = value
    setTitleState(value)
  }

  const flush = useCallback(() => void saverRef.current?.flush(), [])

  /** Puts stored text into the editor without treating it as typing. */
  const showStored = useCallback((content: string) => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      annotations: external.of(true),
    })
    setWords(countWords(content))
  }, [])

  // Create the editor once the freshest text is loaded from storage.
  useEffect(() => {
    let cancelled = false
    let view: EditorView | null = null
    let saver: ChapterSaver | null = null

    void (async () => {
      let content = chapter.content
      try {
        const stored = await getChapter(chapter.id)
        if (stored) content = stored.content
      } catch {
        if (!cancelled) setLoadError(true)
        return
      }
      if (cancelled || !hostRef.current) return

      setWords(countWords(content))
      const created = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: content,
          extensions: [
            history(),
            keymap.of([
              { key: 'Mod-b', run: toggleWrap('**') },
              { key: 'Mod-i', run: toggleWrap('*') },
              ...defaultKeymap,
              ...historyKeymap,
            ]),
            markdown({ addKeymap: false }),
            livePreview(),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({
              spellcheck: 'true',
              autocorrect: 'on',
              autocapitalize: 'sentences',
              'aria-label': 'Kapiteltext',
            }),
            editorTheme,
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return
              if (update.transactions.every((tr) => tr.annotation(external))) return
              saver?.contentChanged()
              window.clearTimeout(countTimer.current)
              countTimer.current = window.setTimeout(
                () => setWords(countWords(update.view.state.doc.toString())),
                COUNT_DELAY,
              )
            }),
            ...(extraExtensions ?? []),
          ],
        }),
      })
      view = created
      saver = new ChapterSaver({
        chapterId: chapter.id,
        initialContent: content,
        getContent: () => created.state.doc.toString(),
        onState: (state) => {
          if (!cancelled) setSaveState(state)
        },
        onTitleSaved: () => {
          titleDirty.current = false
          onChangedRef.current()
        },
        rescue: async (text) => {
          await createChapter(book.id, `${titleRef.current.trim() || 'Unbenannt'} (nicht gespeicherte Fassung)`, text)
          onChangedRef.current()
        },
      })
      viewRef.current = view
      saverRef.current = saver
    })()

    return () => {
      cancelled = true
      window.clearTimeout(countTimer.current)
      const closingView = view
      const closingSaver = saver
      if (viewRef.current === closingView) viewRef.current = null
      if (saverRef.current === closingSaver) saverRef.current = null
      // Save whatever is still pending before the editor goes away.
      const done = closingSaver ? closingSaver.dispose() : Promise.resolve()
      void done.finally(() => closingView?.destroy())
    }
    // The editor is recreated per chapter (the parent keys it by chapter id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id])

  // Never lose the last keystrokes when the tab is hidden or closed,
  // and pick up text that another tab saved while this one was away.
  useEffect(() => {
    const refresh = async () => {
      const newer = await saverRef.current?.checkExternal()
      if (newer !== null && newer !== undefined) showStored(newer)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
      else void refresh()
    }
    const onFocus = () => void refresh()
    window.addEventListener('pagehide', flush)
    window.addEventListener('focus', onFocus)
    // A sync run may have brought a newer version of this chapter.
    window.addEventListener(SYNCED_EVENT, onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(SYNCED_EVENT, onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flush, showStored])

  // Ask before leaving while text could not be stored.
  useEffect(() => {
    if (saveState !== 'error' && saveState !== 'conflict') return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveState])

  // Follow a rename made elsewhere (e.g. in the sidebar) unless a title edit is in progress here.
  useEffect(() => {
    if (!titleDirty.current) setTitle(chapter.title)
  }, [chapter.title])

  // Font and zoom change the text metrics; let CodeMirror measure again.
  useEffect(() => {
    viewRef.current?.requestMeasure()
  }, [font, zoom])

  const changeTitle = (value: string) => {
    setTitle(value)
    titleDirty.current = true
    saverRef.current?.titleChanged(value)
  }

  const commitTitle = async () => {
    await saverRef.current?.flush()
    if (!titleRef.current.trim()) setTitle('Unbenannt')
  }

  const changeFont = async (next: FontId) => {
    setFont(next)
    try {
      await updateBook(book.id, { font: next })
      onChangedRef.current()
    } catch {
      setFont(book.font)
    }
  }

  const loadOther = async () => {
    const stored = await getChapter(chapter.id)
    if (!stored) return
    showStored(stored.content)
    saverRef.current?.adoptExternal(stored.content)
  }

  const saveMineAsCopy = async () => {
    const view = viewRef.current
    if (!view) return
    await createChapter(book.id, `${titleRef.current.trim() || 'Unbenannt'} (meine Fassung)`, view.state.doc.toString())
    await loadOther()
    onChangedRef.current()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    if (event.key === '+' || event.key === '=') setZoom(zoom + ZOOM_STEP)
    else if (event.key === '-') setZoom(zoom - ZOOM_STEP)
    else if (event.key === '0') setZoom(100)
    else return
    event.preventDefault()
  }

  const family = FONTS.find((f) => f.id === font)?.family ?? FONTS[0].family

  return (
    <div className="editor" onKeyDown={onKeyDown}>
      <div className="editor-toolbar">
        <label className="editor-font">
          <span className="muted">Schrift</span>
          <select value={font} onChange={(event) => void changeFont(event.target.value as FontId)}>
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <ZoomControl area="editor" />
      </div>

      {saveState === 'conflict' && (
        <div className="editor-conflict" role="alertdialog" aria-label="Kapitel wurde an anderer Stelle geändert">
          <p>
            <strong>Dieses Kapitel wurde an anderer Stelle geändert.</strong>
          </p>
          <p className="muted">
            Vermutlich in einem anderen Tab oder Fenster. Deine Fassung hier ist noch nicht gespeichert. Es wird nichts
            überschrieben, bis du dich entscheidest.
          </p>
          <div className="editor-conflict-actions">
            <button onClick={() => void saveMineAsCopy()}>Meine als neues Kapitel sichern</button>
            <button onClick={() => void saverRef.current?.keepMine()}>Meine Fassung behalten</button>
            <button onClick={() => void loadOther()}>Andere Fassung laden</button>
          </div>
        </div>
      )}

      <div className="editor-scroll">
        <div className="editor-column" style={{ fontFamily: family, fontSize: `calc(1.125rem * ${zoom / 100})` }}>
          <input
            className="editor-title"
            type="text"
            aria-label="Kapiteltitel"
            value={title}
            onChange={(event) => changeTitle(event.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                viewRef.current?.focus()
              }
            }}
          />
          {loadError ? (
            <p role="alert" className="status-error">
              Das Kapitel konnte nicht geladen werden.
            </p>
          ) : (
            <div ref={hostRef} className="editor-host" />
          )}
        </div>
      </div>

      <StatusBar words={words} saveState={saveState} />
    </div>
  )
}
