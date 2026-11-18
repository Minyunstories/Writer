import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CHANGED_EVENT, SYNCED_EVENT } from '../storage/connection'
import { runSync } from './engine'
import { createGitHubApi, GitHubError, type GitHubErrorKind, type RemoteApi } from './github'
import { clearSyncState, type ConflictNote } from './local'
import { clearSettings, loadSettings, saveSettings, type SyncSettings } from './settings'

export type SyncState = 'unconfigured' | 'idle' | 'pending' | 'running' | 'offline' | 'error'

interface SyncContextValue {
  state: SyncState
  errorKind: GitHubErrorKind | null
  settings: SyncSettings | null
  conflicts: ConflictNote[]
  lastSync: number | null
  /** The repository has changes from another device that are not here yet. */
  remoteWaiting: boolean
  /** Books deleted on another device, waiting for the writer's decision. */
  deletion: { titles: string[]; answer(deleteHere: boolean): void } | null
  syncNow(): void
  save(settings: SyncSettings): Promise<void>
  disconnect(): Promise<void>
  test(settings: SyncSettings): Promise<'ok' | GitHubErrorKind>
  dismissConflicts(): void
}

const SyncContext = createContext<SyncContextValue | null>(null)

/** Null when the app runs without the provider (e.g. in isolated tests). */
export function useSync(): SyncContextValue | null {
  return useContext(SyncContext)
}

interface Props {
  children: ReactNode
  createApi?: (settings: SyncSettings) => RemoteApi
  /** Pause after the last local change before a run, in ms. */
  changeDelay?: number
  /** First pause before a failed run is repeated, in ms. Doubles up to 15 minutes. */
  retryDelay?: number
  /** How often to look whether another device changed the repository, in ms. */
  checkEvery?: number
}

const MAX_RETRY = 15 * 60_000

export function SyncProvider({ children, createApi = createGitHubApi, changeDelay = 20_000, retryDelay = 60_000, checkEvery = 3 * 60_000 }: Props) {
  const [settings, setSettings] = useState<SyncSettings | null>(() => loadSettings())
  const [state, setState] = useState<SyncState>(() => (loadSettings() ? 'pending' : 'unconfigured'))
  const [errorKind, setErrorKind] = useState<GitHubErrorKind | null>(null)
  const [conflicts, setConflicts] = useState<ConflictNote[]>([])
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [deletion, setDeletion] = useState<SyncContextValue['deletion']>(null)
  const [remoteWaiting, setRemoteWaiting] = useState(false)
  /** The repository's latest commit as of the last successful run. */
  const knownHead = useRef<string | null | undefined>(undefined)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const createApiRef = useRef(createApi)
  createApiRef.current = createApi
  const running = useRef(false)
  const dirty = useRef(false)
  const wanted = useRef(false)
  const blocked = useRef(false)
  const failures = useRef(0)
  /** No automatic run before this time (pause after a failure). */
  const pauseUntil = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const alive = useRef(true)

  const run = useCallback(
    async (manual: boolean) => {
      const current = settingsRef.current
      if (!current) return
      if (running.current) {
        wanted.current = true
        return
      }
      // A rejected token or a missing repository will not fix itself; wait for the writer.
      if (blocked.current && !manual) return
      // After a failure, wait out the pause; typing or switching tabs must not shorten it.
      if (!manual && Date.now() < pauseUntil.current) return
      clearTimeout(timer.current)
      running.current = true
      dirty.current = false
      wanted.current = false
      if (alive.current) setState('running')

      let next: SyncState = 'idle'
      let retryIn: number | null = null
      try {
        const result = await runSync(createApiRef.current(current), {
          confirmBookDeletion: (titles) =>
            new Promise<boolean>((resolve) => {
              if (!alive.current) return resolve(false)
              setDeletion({
                titles,
                answer(deleteHere) {
                  setDeletion(null)
                  resolve(deleteHere)
                },
              })
            }),
        })
        failures.current = 0
        pauseUntil.current = 0
        blocked.current = false
        knownHead.current = result.head
        if (alive.current) setRemoteWaiting(false)
        if (result.pulled > 0) window.dispatchEvent(new Event(SYNCED_EVENT))
        if (alive.current) {
          setErrorKind(null)
          setLastSync(Date.now())
          if (result.conflicts.length > 0) setConflicts((known) => [...known, ...result.conflicts])
        }
      } catch (error) {
        const kind = error instanceof GitHubError ? error.kind : 'other'
        next = kind === 'offline' ? 'offline' : 'error'
        if (kind === 'auth' || kind === 'not-found') blocked.current = true
        else retryIn = Math.min(retryDelay * 2 ** failures.current++, MAX_RETRY)
        if (alive.current) setErrorKind(kind)
      } finally {
        running.current = false
      }

      if (!alive.current) return
      if (settingsRef.current !== current) {
        // The settings changed while this run was going: sync with the new ones right away.
        pauseUntil.current = 0
        if (settingsRef.current) void run(true)
        return
      }
      if (next === 'idle' && (dirty.current || wanted.current)) {
        setState('pending')
        timer.current = setTimeout(() => void run(false), changeDelay)
      } else {
        setState(next)
        if (retryIn !== null) {
          pauseUntil.current = Date.now() + retryIn
          // A little past the pause, so the run is not refused as "too early".
          timer.current = setTimeout(() => void run(false), retryIn + 5)
        }
      }
    },
    [changeDelay, retryDelay],
  )

  // Start, local changes, coming back online or into view.
  useEffect(() => {
    alive.current = true
    if (settingsRef.current) void run(false)

    const onChanged = () => {
      if (!settingsRef.current) return
      dirty.current = true
      if (running.current) return
      setState((current) => (current === 'error' || current === 'offline' ? current : 'pending'))
      // While blocked or pausing after a failure, the change is only noted; the retry is already planned.
      if (blocked.current || Date.now() < pauseUntil.current) return
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void run(false), changeDelay)
    }
    const onOnline = () => {
      // The connection is back: no reason to wait any longer.
      pauseUntil.current = 0
      void run(false)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run(false)
    }
    window.addEventListener(CHANGED_EVENT, onChanged)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive.current = false
      clearTimeout(timer.current)
      window.removeEventListener(CHANGED_EVENT, onChanged)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [run, changeDelay])

  // While the app is in view, look now and then whether another device changed the repository.
  useEffect(() => {
    const look = async () => {
      const current = settingsRef.current
      if (!current || running.current || knownHead.current === undefined || document.visibilityState !== 'visible') return
      try {
        const head = await createApiRef.current(current).getHead()
        if (alive.current && !running.current && (head?.commit ?? null) !== knownHead.current) setRemoteWaiting(true)
      } catch {
        // Only a hint; the next real run reports problems.
      }
    }
    const interval = setInterval(() => void look(), checkEvery)
    return () => clearInterval(interval)
  }, [checkEvery])

  const value = useMemo<SyncContextValue>(
    () => ({
      state,
      errorKind,
      settings,
      conflicts,
      lastSync,
      remoteWaiting,
      deletion,
      syncNow: () => void run(true),
      async save(next) {
        const previous = settingsRef.current
        // What was synced with one repository says nothing about another.
        if (previous && (previous.owner !== next.owner || previous.repo !== next.repo)) await clearSyncState()
        saveSettings(next)
        settingsRef.current = next
        blocked.current = false
        failures.current = 0
        pauseUntil.current = 0
        setSettings(next)
        await run(true)
      },
      async disconnect() {
        clearTimeout(timer.current)
        clearSettings()
        settingsRef.current = null
        setSettings(null)
        setErrorKind(null)
        setState('unconfigured')
        await clearSyncState()
      },
      async test(candidate) {
        try {
          await createApiRef.current(candidate).getHead()
          return 'ok'
        } catch (error) {
          return error instanceof GitHubError ? error.kind : 'other'
        }
      },
      dismissConflicts: () => setConflicts([]),
    }),
    [state, errorKind, settings, conflicts, lastSync, remoteWaiting, deletion, run],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
