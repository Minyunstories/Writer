import { ConflictError, getChapter, updateChapter } from '../storage/db'
import type { Chapter } from '../types'

export type SaveState = 'saved' | 'saving' | 'error' | 'conflict'

interface Options {
  chapterId: string
  /** The text as it was loaded from storage. */
  initialContent: string
  getContent: () => string
  onState: (state: SaveState) => void
  /** Called after a title was stored. */
  onTitleSaved?: () => void
  /** Last resort: keep text that could not be saved to this chapter. */
  rescue: (content: string) => Promise<void>
  save?: typeof updateChapter
  /** Debounce before a change is written, in ms. */
  delay?: number
  /** First retry delay after a failed save, in ms. It doubles up to 30 s. */
  retryBase?: number
}

const MAX_RETRY = 30_000
const DISPOSE_ATTEMPTS = 5

/**
 * Writes one chapter's text and title to storage.
 * It never overwrites text that changed elsewhere and never forgets text that failed to save.
 */
export class ChapterSaver {
  state: SaveState = 'saved'

  private dirtyContent = false
  private dirtyTitle: string | null = null
  private lastSaved: string
  private timer: ReturnType<typeof setTimeout> | undefined
  private retryDelay = 0
  private inFlight: Promise<boolean> | null = null
  private disposed = false
  private getContent: () => string
  private readonly save: typeof updateChapter
  private readonly delay: number
  private readonly retryBase: number

  constructor(private readonly options: Options) {
    this.lastSaved = options.initialContent
    this.getContent = options.getContent
    this.save = options.save ?? updateChapter
    this.delay = options.delay ?? 400
    this.retryBase = options.retryBase ?? 1000
  }

  hasPending(): boolean {
    return this.dirtyContent || this.dirtyTitle !== null
  }

  contentChanged(): void {
    this.dirtyContent = true
    this.schedule()
  }

  titleChanged(title: string): void {
    this.dirtyTitle = title
    this.schedule()
  }

  /** Writes pending changes now. Resolves to true when everything is stored. */
  async flush(force = false): Promise<boolean> {
    clearTimeout(this.timer)
    while (this.inFlight) await this.inFlight
    if (this.state === 'conflict' && !force) return false
    if (!this.hasPending()) return true

    const patch: Partial<Pick<Chapter, 'title' | 'content'>> = {}
    const content = this.dirtyContent ? this.getContent() : undefined
    const title = this.dirtyTitle
    if (content !== undefined) patch.content = content
    if (title !== null) patch.title = title
    this.dirtyContent = false
    this.dirtyTitle = null

    const run = (async () => {
      try {
        await this.save(
          this.options.chapterId,
          patch,
          content !== undefined && !force ? { expectedContent: this.lastSaved } : undefined,
        )
        if (content !== undefined) this.lastSaved = content
        this.retryDelay = 0
        if (!this.hasPending()) this.setState('saved')
        if (title !== null) this.options.onTitleSaved?.()
        return true
      } catch (error) {
        // Nothing was written: everything is pending again.
        if (content !== undefined) this.dirtyContent = true
        if (title !== null && this.dirtyTitle === null) this.dirtyTitle = title
        if (error instanceof ConflictError) {
          this.setState('conflict')
        } else {
          this.setState('error')
          if (!this.disposed) {
            this.retryDelay = Math.min(this.retryDelay ? this.retryDelay * 2 : this.retryBase, MAX_RETRY)
            this.timer = setTimeout(() => void this.flush(), this.retryDelay)
          }
        }
        return false
      }
    })()

    this.inFlight = run
    const ok = await run
    if (this.inFlight === run) this.inFlight = null
    return ok
  }

  /** Resolves a conflict in favour of the text in this editor. */
  async keepMine(): Promise<boolean> {
    this.dirtyContent = true
    this.setState('saving')
    return this.flush(true)
  }

  /** Call after the editor was replaced with the stored text. */
  adoptExternal(content: string): void {
    this.lastSaved = content
    this.dirtyContent = false
    this.setState(this.hasPending() ? 'saving' : 'saved')
    if (this.hasPending()) this.schedule()
  }

  /**
   * Returns newer stored text if there is some and nothing is pending here.
   * With pending changes the next save detects the conflict instead.
   */
  async checkExternal(): Promise<string | null> {
    if (this.dirtyContent || this.inFlight || this.state === 'conflict' || this.disposed) return null
    let stored: Chapter | undefined
    try {
      stored = await getChapter(this.options.chapterId)
    } catch {
      return null
    }
    if (!stored || stored.content === this.lastSaved) return null
    if (this.dirtyContent || this.inFlight) return null
    this.lastSaved = stored.content
    return stored.content
  }

  /** Final save when the editor goes away. Text that cannot be stored is rescued. */
  async dispose(): Promise<void> {
    this.disposed = true
    clearTimeout(this.timer)
    const snapshot = this.getContent()
    this.getContent = () => snapshot

    let wait = this.retryBase
    for (let attempt = 0; attempt < DISPOSE_ATTEMPTS; attempt++) {
      if (await this.flush()) return
      if (this.state === 'conflict') break
      await new Promise((resolve) => setTimeout(resolve, wait))
      wait = Math.min(wait * 2, MAX_RETRY)
    }
    if (this.dirtyContent) {
      try {
        await this.options.rescue(snapshot)
      } catch {
        // Storage is unavailable altogether; there is nowhere left to put the text.
      }
    }
  }

  private schedule(): void {
    if (this.state !== 'conflict') this.setState('saving')
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.delay)
  }

  private setState(state: SaveState): void {
    if (this.state === state) return
    this.state = state
    this.options.onState(state)
  }
}
