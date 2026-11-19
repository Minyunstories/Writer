import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, showTooltip, ViewPlugin, type DecorationSet, type Tooltip, type ViewUpdate } from '@codemirror/view'
import type { AddressFinding } from './addressCheck'

export interface AddressMarkOptions {
  /** Read on every run: switched off, the marks go away. */
  enabled: () => boolean
  /** The check itself (see addressCheck.ts), with the book's current data. */
  check: (text: string) => AddressFinding[]
  /** A window event that makes every editor look again (settings or forms of address changed). */
  recheckEvent?: string
  /** Pause after typing before looking again, in ms. */
  delay?: number
}

const setFindings = StateEffect.define<AddressFinding[]>()

/** The marked forms; between two runs they move with the text, and forms typed over drop out. */
const findingsField = StateField.define<AddressFinding[]>({
  create: () => [],
  update(findings, tr) {
    for (const effect of tr.effects) if (effect.is(setFindings)) return effect.value
    if (!tr.docChanged || findings.length === 0) return findings
    const moved: AddressFinding[] = []
    for (const finding of findings) {
      let touched = false
      tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA < finding.to && toA > finding.from) touched = true
      })
      if (touched) continue
      const from = tr.changes.mapPos(finding.from, 1)
      const to = tr.changes.mapPos(finding.to, -1)
      if (from < to) moved.push({ ...finding, from, to })
    }
    return moved
  },
  provide: (field) =>
    EditorView.decorations.from(field, (findings): DecorationSet =>
      findings.length
        ? Decoration.set(findings.map((finding) => Decoration.mark({ class: 'cm-mw-address', attributes: { title: finding.message } }).range(finding.from, finding.to)))
        : Decoration.none,
    ),
})

/** With the cursor in a marked form: the hint and buttons to put in a fitting form. */
const hint = showTooltip.compute(['selection', findingsField], (state): Tooltip | null => {
  const selection = state.selection.main
  if (!selection.empty) return null
  const finding = state.field(findingsField).find((item) => item.from <= selection.head && selection.head <= item.to)
  if (!finding) return null
  return {
    pos: finding.from,
    above: false,
    create: (view) => {
      const dom = document.createElement('div')
      dom.className = 'cm-mw-address-box'
      const message = document.createElement('p')
      message.textContent = finding.message
      dom.append(message)
      if (finding.suggestions.length) {
        const actions = document.createElement('div')
        actions.className = 'cm-mw-address-actions'
        for (const suggestion of finding.suggestions) {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = suggestion
          button.setAttribute('aria-label', `Ersetzen durch „${suggestion}“`)
          // Keep the cursor in the text.
          button.addEventListener('mousedown', (event) => event.preventDefault())
          button.addEventListener('click', () => {
            view.dispatch({
              changes: { from: finding.from, to: finding.to, insert: suggestion },
              selection: { anchor: finding.from + suggestion.length },
              userEvent: 'input',
            })
            view.focus()
          })
          actions.append(button)
        }
        dom.append(actions)
      }
      return { dom }
    },
  }
})

const addressTheme = EditorView.baseTheme({
  // Dashed and lower than the spelling's wavy line, in its own colour (repeats are dotted blue).
  '.cm-mw-address': { borderBottom: '2px dashed rgba(196, 150, 222, 0.85)', paddingBottom: '0.3em' },
  '.cm-tooltip:has(> .cm-mw-address-box)': {
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.45)',
    color: 'var(--text)',
  },
  '.cm-mw-address-box': { maxWidth: '22rem', padding: '0.6rem 0.7rem', fontFamily: 'var(--font-ui)', fontSize: '13px', lineHeight: '1.45' },
  '.cm-mw-address-box p': { margin: '0' },
  '.cm-mw-address-actions': { display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' },
  '.cm-mw-address-actions button': {
    padding: '0.3rem 0.6rem',
    border: '1px solid var(--accent)',
    borderRadius: '999px',
    background: 'transparent',
    color: 'var(--text)',
    fontSize: '13px',
    cursor: 'pointer',
  },
})

/** Forms of address in dialogue that fit nobody in the chapter, marked a moment after typing stops. */
export function addressMarks(options: AddressMarkOptions): Extension {
  const delay = options.delay ?? 500
  const runner = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined
      onEvent = () => this.schedule(0)
      constructor(readonly view: EditorView) {
        this.schedule(0)
        if (options.recheckEvent) window.addEventListener(options.recheckEvent, this.onEvent)
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.schedule(delay)
      }
      schedule(wait: number) {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.run(), wait)
      }
      run() {
        const findings = options.enabled() ? options.check(this.view.state.doc.toString()) : []
        if (findings.length === 0 && this.view.state.field(findingsField).length === 0) return
        this.view.dispatch({ effects: setFindings.of(findings) })
      }
      destroy() {
        clearTimeout(this.timer)
        if (options.recheckEvent) window.removeEventListener(options.recheckEvent, this.onEvent)
      }
    },
  )
  return [findingsField, hint, runner, addressTheme]
}
