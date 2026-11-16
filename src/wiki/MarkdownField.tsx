import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { editorTheme } from '../editor/editorTheme'
import { writingMarkdown } from '../editor/markdownSetup'

interface Props {
  /** Initial text. Later changes of this prop are ignored; remount with a key to replace the text. */
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  /** E.g. wiki links. Read once when the field is created. */
  extensions?: Extension[]
}

/** A small text field with the same live formatting as the chapter editor. */
export function MarkdownField({ value, onChange, ariaLabel, placeholder, extensions }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          writingMarkdown(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': ariaLabel }),
          placeholder ? placeholderExtension(placeholder) : [],
          editorTheme,
          EditorView.theme({ '.cm-content': { minHeight: '6em' } }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
          ...(extensions ?? []),
        ],
      }),
    })
    return () => view.destroy()
    // Created once per mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="markdown-field" />
}
