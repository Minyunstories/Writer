import { formatWordCount } from '../lib/wordCount'
import type { SaveState } from './saver'

const LABEL: Record<SaveState, string> = {
  saved: 'Gespeichert',
  saving: 'Speichert …',
  error: 'Speichern fehlgeschlagen, neuer Versuch läuft',
  conflict: 'Nicht gespeichert',
}

export function StatusBar({ words, saveState }: { words: number; saveState: SaveState }) {
  const problem = saveState === 'error' || saveState === 'conflict'
  return (
    <footer className="editor-status">
      <span>{formatWordCount(words)}</span>
      <span className={problem ? 'status-error' : undefined} role={problem ? 'alert' : undefined}>
        {LABEL[saveState]}
      </span>
    </footer>
  )
}
