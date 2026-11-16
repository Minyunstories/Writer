import { useEffect, useState } from 'react'
import type { GitHubErrorKind } from './github'
import type { ConflictNote } from './local'
import { maskToken, parseRepository } from './settings'
import { useSync, type SyncState } from './SyncProvider'
import './sync.css'

const LABEL: Record<SyncState, string> = {
  unconfigured: 'Nicht eingerichtet',
  idle: 'Synchronisiert',
  pending: 'Änderungen ausstehend',
  running: 'Wird synchronisiert …',
  offline: 'Offline',
  error: 'Fehler',
}

const ERROR_TEXT: Record<GitHubErrorKind, string> = {
  auth: 'Der Zugangsschlüssel wurde abgelehnt. Prüfe, ob er noch gültig ist und Lese- und Schreibrechte auf die Inhalte dieses Repositorys hat.',
  'not-found': 'Repository nicht gefunden. Prüfe den Namen und ob der Zugangsschlüssel für dieses Repository gilt.',
  offline: 'GitHub ist gerade nicht erreichbar. Deine Änderungen bleiben auf diesem Gerät und werden später übertragen.',
  'rate-limit': 'GitHub bremst gerade. Der nächste Versuch folgt automatisch.',
  conflict: 'Das Repository wurde gleichzeitig von einem anderen Gerät geändert. Der nächste Versuch folgt automatisch.',
  other: 'Die Synchronisation ist fehlgeschlagen. Der nächste Versuch folgt automatisch.',
}

function describe(note: ConflictNote): string {
  const book = `„${note.bookTitle}"`
  switch (note.kind) {
    case 'chapter':
      return `Kapitel „${note.name}" in ${book}: Die Fassung von diesem Gerät steht als eigenes Kapitel direkt dahinter.`
    case 'entry':
      return `Wiki-Eintrag „${note.name}" in ${book}: Die Fassung von diesem Gerät steht als eigener Eintrag daneben.`
    case 'outline':
      return `Notiz zu „${note.name}" in ${book}: Beide Notizen stehen jetzt untereinander.`
    case 'book':
      return `Titel und Kapitelreihenfolge von ${book}: Es gilt der Stand des anderen Geräts; neue Kapitel von hier hängen am Ende.`
    case 'folders':
      return `Wiki-Ordner in ${book}: Die Ordner beider Geräte wurden zusammengeführt.`
    default:
      return `Bild in ${book}: Es gilt der Stand des anderen Geräts.`
  }
}

/** The sync indicator. A click opens the settings. Renders nothing when sync is not part of the app. */
export function SyncStatus() {
  const sync = useSync()
  const [open, setOpen] = useState(false)
  if (!sync) return null

  return (
    <>
      <button className={`ghost sync-status sync-${sync.state}`} aria-label={`Sync: ${LABEL[sync.state]}`} onClick={() => setOpen(true)}>
        <span className="sync-dot" aria-hidden="true" />
        <span className="sync-label">{LABEL[sync.state]}</span>
      </button>
      {open && <SyncSettingsDialog onClose={() => setOpen(false)} />}
      {sync.deletion && (
        <div className="dialog-backdrop">
          <div className="dialog sync-dialog" role="alertdialog" aria-modal="true" aria-label="Buch auf einem anderen Gerät gelöscht">
            <h2>Buch auf einem anderen Gerät gelöscht</h2>
            <p>
              {sync.deletion.titles.length === 1 ? 'Dieses Buch wurde' : 'Diese Bücher wurden'} auf einem anderen Gerät oder im
              Repository gelöscht: {sync.deletion.titles.map((title) => `„${title}"`).join(', ')}.
            </p>
            <p className="muted">
              „Behalten" lässt alles auf diesem Gerät und überträgt es wieder ins Repository. „Hier auch löschen" entfernt es
              von diesem Gerät.
            </p>
            <div className="dialog-actions">
              <button className="ghost danger" onClick={() => sync.deletion?.answer(true)}>
                Hier auch löschen
              </button>
              <button className="primary" onClick={() => sync.deletion?.answer(false)}>
                Behalten
              </button>
            </div>
          </div>
        </div>
      )}
      {sync.conflicts.length > 0 && (
        <div className="dialog-backdrop">
          <div className="dialog sync-dialog" role="alertdialog" aria-modal="true" aria-label="Konflikte bei der Synchronisation">
            <h2>Konflikte bei der Synchronisation</h2>
            <p className="muted">
              Dieselben Inhalte wurden auf zwei Geräten geändert. Es ging nichts verloren: beide Fassungen sind erhalten. Sieh sie
              dir an und lösche, was du nicht mehr brauchst.
            </p>
            <ul className="sync-conflicts">
              {sync.conflicts.map((note, index) => (
                <li key={index}>{describe(note)}</li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button className="primary" onClick={sync.dismissConflicts}>
                Verstanden
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function SyncSettingsDialog({ onClose }: { onClose: () => void }) {
  const sync = useSync()!
  const saved = sync.settings
  const [repository, setRepository] = useState(saved ? `${saved.owner}/${saved.repo}` : '')
  const [token, setToken] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** The values in the form, with the stored token when none was typed. */
  const candidate = () => {
    const parsed = parseRepository(repository)
    const useToken = token.trim() || saved?.token || ''
    if (!parsed) {
      setMessage({ ok: false, text: 'Gib das Repository als „Name/Repository" oder als GitHub-Link an.' })
      return null
    }
    if (!useToken) {
      setMessage({ ok: false, text: 'Es fehlt der Zugangsschlüssel.' })
      return null
    }
    return { ...parsed, token: useToken }
  }

  const test = async () => {
    const values = candidate()
    if (!values) return
    setBusy(true)
    setMessage(null)
    const result = await sync.test(values)
    setBusy(false)
    setMessage(result === 'ok' ? { ok: true, text: 'Verbindung steht.' } : { ok: false, text: ERROR_TEXT[result] })
  }

  const save = async () => {
    const values = candidate()
    if (!values) return
    setBusy(true)
    setMessage(null)
    setToken('')
    await sync.save(values)
    setBusy(false)
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog sync-dialog" role="dialog" aria-modal="true" aria-label="Synchronisation">
        <h2>Synchronisation</h2>
        <p className="muted">
          Deine Bücher werden mit einem privaten GitHub-Repository abgeglichen. Der Zugangsschlüssel bleibt nur in diesem
          Browser gespeichert.
        </p>

        <p className={`sync-current sync-${sync.state}`}>
          <span className="sync-dot" aria-hidden="true" />
          {LABEL[sync.state]}
          {sync.lastSync && sync.state !== 'running' ? `, zuletzt um ${new Date(sync.lastSync).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : ''}
        </p>
        {(sync.state === 'error' || sync.state === 'offline') && sync.errorKind && (
          <p className="status-error" role="alert">
            {ERROR_TEXT[sync.errorKind]}
          </p>
        )}

        <label className="sync-field">
          <span>Repository</span>
          <input
            type="text"
            value={repository}
            placeholder="Name/Repository oder GitHub-Link"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setRepository(event.target.value)}
          />
        </label>
        <label className="sync-field">
          <span>Zugangsschlüssel</span>
          <input
            type="password"
            value={token}
            placeholder={saved ? 'Neuen Schlüssel eingeben, um ihn zu ersetzen' : 'github_pat_…'}
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        {saved && <p className="muted sync-hint">Gespeichert: {maskToken(saved.token)}</p>}

        {message && (
          <p className={message.ok ? 'sync-ok' : 'status-error'} role="status">
            {message.text}
          </p>
        )}

        <div className="sync-actions">
          <button onClick={() => void test()} disabled={busy}>
            Verbindung testen
          </button>
          <button className="primary" onClick={() => void save()} disabled={busy}>
            Speichern
          </button>
        </div>

        {saved && (
          <div className="sync-actions sync-secondary">
            <button onClick={sync.syncNow} disabled={sync.state === 'running'}>
              Jetzt synchronisieren
            </button>
            <button className="ghost danger" onClick={() => void sync.disconnect()}>
              Verbindung trennen
            </button>
          </div>
        )}

        <details className="sync-help">
          <summary>So bekommst du einen Zugangsschlüssel</summary>
          <ol>
            <li>Bei GitHub: Settings, Developer settings, Personal access tokens, Fine-grained tokens, „Generate new token".</li>
            <li>Bei „Repository access" „Only select repositories" wählen und nur dein Bücher-Repository auswählen.</li>
            <li>Bei „Permissions", „Repository permissions" den Punkt „Contents" auf „Read and write" stellen.</li>
            <li>Schlüssel erzeugen, kopieren und hier einfügen. Auf jedem Gerät einmal.</li>
          </ol>
        </details>

        <div className="dialog-actions">
          <button className="ghost" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
