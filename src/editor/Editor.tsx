import { showSynonyms, synonyms } from '../synonyms/synonymBox'
import { autoVersion } from '../storage/versions'
import { VersionsDialog } from '../versions/VersionsDialog'
import { Icon } from '../ui/Icon'
import { StatusPicker } from '../book/StatusPicker'
import { addCommentAtSelection, commentMarks, refreshComments } from '../comments/commentMarks'
import { addComment, COMMENTS_EVENT, deleteComment, placeComments, resolveAnchor, updateComment } from '../storage/comments'
import { currentParagraph, FOCUS_EVENT, isFocusMode, setFocusMode } from './focusMode'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { Annotation, EditorSelection, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ZoomControl } from '../book/ZoomControl'
import { countWords } from '../lib/wordCount'
import { useZoom, ZOOM_STEP } from '../lib/zoom'
import { SYNCED_EVENT } from '../storage/connection'
import { createChapter, getChapter, savePlace, updateBook } from '../storage/db'
import type { Book, Chapter, FontId } from '../types'
import { editorTheme } from './editorTheme'
import { CheckMenu } from '../grammar/CheckMenu'
import { isModuleOn } from '../modules/modules'
import { toggleHighlight, typewriter, writingMarkdown } from './markdownSetup'
import { sceneNames } from './sceneNames'
import { pasteParagraphs } from './paragraphs'
import { ChapterSaver, type SaveState } from './saver'
import { minimalChanges } from './minimalChanges'
import { StatusBar } from './StatusBar'
import './editor.css'

const COUNT_DELAY = 250
/** The place where text changed is stored this long after the last keystroke. */
const PLACE_DELAY = 1000

/** A short highlight where the writer jumped to, e.g. from "Erwähnt in". */
const flash = StateEffect.define<{ from: number; to: number } | null>()
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(flash)) {
        next = effect.value && effect.value.to > effect.value.from
          ? Decoration.set([Decoration.mark({ class: 'cm-mw-flash' }).range(effect.value.from, effect.value.to)])
          : Decoration.none
      }
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

export interface JumpTarget {
  from: number
  to: number
  /** A new key jumps again, even to the same place. */
  key: number
  /** Put the keyboard focus into the text, e.g. on a computer to keep writing at once. */
  focus?: boolean
}

function jump(view: EditorView, target: JumpTarget) {
  const length = view.state.doc.length
  const from = Math.min(Math.max(target.from, 0), length)
  let to = Math.min(Math.max(target.to, from), length)
  let markFrom = from
  if (to === from) {
    // A bare cursor position: mark its line, so the eye finds it.
    const line = view.state.doc.lineAt(from)
    markFrom = line.from
    to = line.to
  }
  // The cursor goes in front of the place, which is only marked: typing never replaces it.
  view.dispatch({
    selection: EditorSelection.cursor(from),
    effects: [EditorView.scrollIntoView(from, { y: 'center' }), ...(to > markFrom ? [flash.of({ from: markFrom, to })] : [])],
  })
  if (target.focus) view.focus()
  window.setTimeout(() => {
    // The view may be gone by then.
    if (view.dom.isConnected) view.dispatch({ effects: flash.of(null) })
  }, 2500)
}

/** Marks a change that came from storage, not from the writer. */
const external = Annotation.define<boolean>()

const FONTS: { id: FontId; label: string; family: string }[] = [
  { id: 'literata', label: 'Literata', family: "'Literata', Georgia, serif" },
  { id: 'inter', label: 'Inter', family: "'Inter', system-ui, sans-serif" },
  { id: 'courier-prime', label: 'Courier Prime', family: "'Courier Prime', 'Courier New', monospace" },
]

interface Props {
  book: Book
  chapter: Chapter
  /** Called after title, font or the chapter list changed, so the surrounding view can refresh. */
  onChanged: () => void
  /** Hook for later stages, e.g. wiki links. */
  extraExtensions?: Extension[]
  /** Put the cursor at this range and mark it, e.g. a mention the writer jumped to. */
  jumpTo?: JumpTarget
  /** Called once the jump happened. */
  onJumped?: () => void
}

export function Editor({ book, chapter, onChanged, extraExtensions, jumpTo, onJumped }: Props) {
  const onJumpedRef = useRef(onJumped)
  onJumpedRef.current = onJumped
  const pendingJump = useRef<JumpTarget | undefined>(jumpTo)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saverRef = useRef<ChapterSaver | null>(null)
  const countTimer = useRef<number>()
  const placeTimer = useRef<number>()
  const titleRef = useRef(chapter.title)
  const titleDirty = useRef(false)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  const [title, setTitleState] = useState(chapter.title)
  const [font, setFont] = useState<FontId>(book.font)
  const [words, setWords] = useState(() => countWords(chapter.content))
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [commentError, setCommentError] = useState(false)
  const [commentHint, setCommentHint] = useState(false)
  useEffect(() => {
    if (!commentHint) return
    const timer = window.setTimeout(() => setCommentHint(false), 3000)
    return () => window.clearTimeout(timer)
  }, [commentHint])
  // Comments changed in the panel or by a sync run: show them here too.
  useEffect(() => {
    const onComments = (event: Event) => {
      const id = (event as CustomEvent<string | undefined>).detail
      if (id !== undefined && id !== null && id !== chapter.id) return
      void getChapter(chapter.id).then((stored) => {
        const view = viewRef.current
        if (stored && view) refreshComments(view, (stored.comments ?? []).map((comment) => ({ ...comment, ...resolveAnchor(view.state.doc.toString(), comment) })))
      })
    }
    window.addEventListener(COMMENTS_EVENT, onComments)
    window.addEventListener(SYNCED_EVENT, onComments as EventListener)
    return () => {
      window.removeEventListener(COMMENTS_EVENT, onComments)
      window.removeEventListener(SYNCED_EVENT, onComments as EventListener)
    }
  }, [chapter.id])
  const [focus, setFocus] = useState(isFocusMode)
  useEffect(() => {
    const onFocusChange = () => setFocus(isFocusMode())
    // Esc leaves focus mode, unless something in the text (a box, a list) used it first.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isFocusMode()) setFocusMode(false)
    }
    window.addEventListener(FOCUS_EVENT, onFocusChange)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(FOCUS_EVENT, onFocusChange)
      window.removeEventListener('keydown', onKey)
      setFocusMode(false)
    }
  }, [])
  const toggleFocus = () => {
    setFocusMode(!isFocusMode())
    viewRef.current?.focus()
  }
  const [loadError, setLoadError] = useState(false)
  const [zoom, setZoom] = useZoom('editor')

  const setTitle = (value: string) => {
    titleRef.current = value
    setTitleState(value)
  }

  const flush = useCallback(() => void saverRef.current?.flush(), [])
  // After a menu in the toolbar closes with Esc, writing goes on where it was.
  const returnToText = useCallback(() => viewRef.current?.focus(), [])

  /**
   * Puts stored text into the editor without treating it as typing. Only the spots that differ are
   * changed, so the cursor and the comments elsewhere stay put; then the comments are placed again
   * from storage against the new text (a merge or a rename may have moved or added some).
   */
  const showStored = useCallback(
    (content: string) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        changes: minimalChanges(view.state.doc.toString(), content),
        annotations: external.of(true),
      })
      setWords(countWords(content))
      void getChapter(chapter.id).then((stored) => {
        if (!stored || viewRef.current !== view) return
        const text = view.state.doc.toString()
        refreshComments(
          view,
          (stored.comments ?? []).map((comment) => ({ ...comment, ...resolveAnchor(text, comment) })),
          { trustGiven: true },
        )
      })
    },
    // The editor is recreated per chapter, so the id does not change while this exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Create the editor once the freshest text is loaded from storage.
  useEffect(() => {
    let cancelled = false
    let view: EditorView | null = null
    let saver: ChapterSaver | null = null
    /** Where text changed last, not yet stored; the book reopens there. */
    let placeOffset: number | null = null

    const storePlace = () => {
      if (placeOffset === null) return
      const offset = placeOffset
      placeOffset = null
      void savePlace(book.id, { chapterId: chapter.id, offset, at: Date.now() }).catch(() => {})
    }
    const rememberPlace = (offset: number) => {
      placeOffset = offset
      window.clearTimeout(placeTimer.current)
      placeTimer.current = window.setTimeout(storePlace, PLACE_DELAY)
    }

    void (async () => {
      let content = chapter.content
      let comments = chapter.comments ?? []
      try {
        const stored = await getChapter(chapter.id)
        if (stored) {
          content = stored.content
          comments = stored.comments ?? []
        }
      } catch {
        if (!cancelled) setLoadError(true)
        return
      }
      if (cancelled || !hostRef.current) return

      setWords(countWords(content))
      // A safety copy of the text as it was found, before today's changes.
      void autoVersion(chapter, content).catch(() => {})
      const created = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: content,
          extensions: [
            history(),
            writingMarkdown(),
            sceneNames({
              // A jump into a scene name (search, mentions) shows the line as text, so the mark is visible.
              reveal: (state) => {
                const found: { from: number; to: number }[] = []
                state.field(flashField).between(0, state.doc.length, (from, to) => void found.push({ from, to }))
                return found
              },
            }),
            pasteParagraphs,
            synonyms(),
            currentParagraph,
            commentMarks(
              comments.map((comment) => ({ ...comment, ...resolveAnchor(content, comment) })),
              {
                onAdd: (place) => addComment(chapter.id, { ...place, text: '' }),
                onUpdate: (id, patch) => void updateComment(chapter.id, id, patch).catch(() => setCommentError(true)),
                onDelete: (id) => void deleteComment(chapter.id, id).catch(() => setCommentError(true)),
                onPlace: (places) => void placeComments(chapter.id, places).catch(() => {}),
              },
            ),
            keymap.of([{ key: 'Mod-Alt-m', run: addCommentAtSelection, preventDefault: true }]),
            typewriter,
            keymap.of([...defaultKeymap, ...historyKeymap]),
            flashField,
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
              rememberPlace(update.state.selection.main.head)
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
      if (pendingJump.current) {
        jump(view, pendingJump.current)
        pendingJump.current = undefined
        onJumpedRef.current?.()
      }
    })()

    return () => {
      cancelled = true
      window.clearTimeout(countTimer.current)
      window.clearTimeout(placeTimer.current)
      storePlace()
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

  // Jump when asked to; if the editor is still loading, it jumps once it is there.
  useEffect(() => {
    if (!jumpTo) return
    if (viewRef.current) {
      jump(viewRef.current, jumpTo)
      onJumpedRef.current?.()
    } else pendingJump.current = jumpTo
    // The key decides; the object may be recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.key])

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
    if (event.shiftKey && event.key === 'Enter') {
      event.preventDefault()
      toggleFocus()
      return
    }
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
        <span className="editor-toolbar-start">
          <StatusPicker chapter={{ id: chapter.id, title: chapter.title, status: chapter.status }} onChanged={() => onChangedRef.current()} />
        </span>
        <button
          type="button"
          className="editor-highlight"
          title="Auswahl markieren (Strg+Umschalt+H)"
          // Keep the selection in the text while the button is pressed.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const view = viewRef.current
            if (!view) return
            toggleHighlight(view)
            view.focus()
          }}
        >
          <span className="editor-highlight-swatch" aria-hidden="true" />
          <span className="tool-label">Markieren</span>
        </button>
        <button
          type="button"
          className="editor-highlight"
          title="Synonyme für das Wort am Cursor (Strg+Umschalt+S)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const view = viewRef.current
            if (!view) return
            showSynonyms(view)
            view.focus()
          }}
        >
          <Icon name="synonyms" />
          <span className="tool-label">Synonyme</span>
        </button>
        <CheckMenu onReturn={returnToText} address={isModuleOn(book, 'address')} />
 <button
          className="editor-highlight"
          title="Kommentar zum markierten Text (Strg+Alt+M)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const view = viewRef.current
            if (view && !addCommentAtSelection(view)) setCommentHint(true)
            view?.focus()
          }}
        >
          <Icon name="comment" />
          <span className="tool-label">Kommentar</span>
        </button>
        <button className="editor-highlight" title="Gesicherte Fassungen dieses Kapitels" onClick={() => setVersionsOpen(true)}>
          <Icon name="versions" />
          <span className="tool-label">Fassungen</span>
        </button>
        <button className="editor-highlight" title="Fokusmodus: nur der Text (Strg+Umschalt+Enter, Esc beendet)" onMouseDown={(event) => event.preventDefault()} onClick={toggleFocus}>
          <Icon name="focus" />
          <span className="tool-label">Fokus</span>
        </button>
        <span className="editor-toolbar-divider" aria-hidden="true" />
        <label className="editor-font">
          <Icon name="font" />
          <span className="muted tool-label">Schrift</span>
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

      {(commentHint || commentError) && (
        <p className="editor-hint" role="status">
          {commentError ? 'Der Kommentar konnte nicht gespeichert werden.' : 'Erst den Text markieren, zu dem der Kommentar gehört.'}
        </p>
      )}
      {focus && (
        <button className="focus-exit ghost" onMouseDown={(event) => event.preventDefault()} onClick={toggleFocus}>
          Fokus beenden
        </button>
      )}
      {versionsOpen && (
        <VersionsDialog
          chapter={{ id: chapter.id, bookId: book.id, title: titleRef.current.trim() || chapter.title }}
          current={() => viewRef.current?.state.doc.toString() ?? chapter.content}
          onRestore={(content) => {
            const view = viewRef.current
            if (!view) return
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content }, userEvent: 'input' })
            view.focus()
          }}
          onClose={() => setVersionsOpen(false)}
        />
      )}
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
