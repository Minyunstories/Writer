import { bookIdOf, bookPrefix, classifyPath, parseJson, type BookFile, type FileData, type FileSet } from './files'
import { GitHubError, type RemoteApi } from './github'
import { gitBlobSha } from './hash'
import { applyRemoteFiles, loadSyncState, readLocalFiles, saveSyncState, type ConflictNote } from './local'
import { keepBooksWhole, planSync, type Plan, type ShaMap } from './plan'

export interface SyncResult {
  /** Files uploaded or deleted in the repository. */
  pushed: number
  /** Files downloaded, merged or deleted on this device. */
  pulled: number
  conflicts: ConflictNote[]
}

export interface SyncOptions {
  /**
   * Asked before books that were deleted on another device are deleted here.
   * Without an answer of true the books stay and are uploaded again.
   */
  confirmBookDeletion?: (titles: string[]) => Promise<boolean>
}

const MAX_ATTEMPTS = 3
const COMMIT_MESSAGE = 'Writer: Synchronisation'
/** Text up to this size travels inside the commit request; larger files are uploaded on their own. */
const INLINE_FILE_LIMIT = 200_000
const INLINE_TOTAL_LIMIT = 2_000_000
/** Written with the first sync. Its absence means the repository is new, recreated or was emptied by hand. */
export const MARKER_PATH = 'books/.minyunwriter.json'
const MARKER_CONTENT = '{\n  "format": 1\n}\n'

async function hashAll(files: FileSet): Promise<ShaMap> {
  const hashes = await Promise.all([...files].map(async ([path, data]) => [path, await gitBlobSha(data)] as const))
  return new Map(hashes)
}

/** Whole-book deletions coming from the repository need the writer's consent. */
async function settleBookDeletions(plan: Plan, snapshot: FileSet, options: SyncOptions): Promise<Plan> {
  const doomed = plan.deleteLocal.flatMap((path) => {
    const info = classifyPath(path)
    return info?.kind === 'book' ? [info.bookId] : []
  })
  if (doomed.length === 0) return plan
  const titles = doomed.map((bookId) => parseJson<BookFile>(snapshot.get(`${bookPrefix(bookId)}book.json`))?.title ?? 'Unbenannt')
  const agreed = options.confirmBookDeletion ? await options.confirmBookDeletion(titles) : false
  if (agreed) return plan
  // Kept: the books go back into the repository.
  const keep = (path: string) => doomed.includes(bookIdOf(path) ?? '')
  return {
    ...plan,
    push: [...plan.push, ...plan.deleteLocal.filter(keep)].sort(),
    deleteLocal: plan.deleteLocal.filter((path) => !keep(path)),
  }
}

async function once(api: RemoteApi, options: SyncOptions, noted: ConflictNote[]): Promise<SyncResult> {
  const head = await api.getHead()
  const tree = head ? await api.getTree(head.tree) : new Map<string, string>()
  // Only files the app manages take part; everything else in the repository is left alone.
  const remote: ShaMap = new Map([...tree].filter(([path]) => classifyPath(path) !== null))

  const snapshot = await readLocalFiles()
  const local = await hashAll(snapshot)
  let base = (await loadSyncState(api.id))?.base ?? new Map<string, string>()
  // Without the marker the repository is new, recreated or was emptied by hand. Missing files
  // are then never read as "deleted on another device": start over, which only adds.
  const initialised = tree.has(MARKER_PATH)
  if (!initialised) base = new Map()

  const plan = await settleBookDeletions(keepBooksWhole(planSync(base, local, remote), bookIdOf), snapshot, options)

  // 1. Bring repository changes to this device.
  const pulled = plan.pull.length + plan.conflicts.length + plan.deleteLocal.length
  const skipped = new Set<string>()
  let current = snapshot
  let currentSha = local
  if (pulled > 0) {
    const fetchBlob = (path: string): Promise<FileData> => api.getBlob(remote.get(path)!)
    const write: FileSet = new Map()
    for (const path of plan.pull) write.set(path, await fetchBlob(path))
    const both = []
    for (const path of plan.conflicts) both.push({ path, remote: await fetchBlob(path) })
    const applied = await applyRemoteFiles({ write, remove: plan.deleteLocal, conflicts: both, snapshot })
    noted.push(...applied.notes)
    for (const path of applied.skipped) skipped.add(path)

    // Remember at once what was taken over. If the rest of this run fails or is repeated,
    // the same repository change is then not applied, merged or copied a second time.
    const progress = new Map(base)
    for (const path of [...plan.pull, ...plan.conflicts]) {
      if (!skipped.has(path)) progress.set(path, remote.get(path)!)
    }
    for (const path of plan.deleteLocal) progress.delete(path)
    await saveSyncState(api.id, progress)
    base = progress

    current = await readLocalFiles()
    currentSha = await hashAll(current)
  }

  // 2. Send what differs to the repository, as one commit.
  const known = new Set(tree.values())
  const write = new Map<string, string>()
  const inline = new Map<string, string>()
  let inlineBytes = 0
  for (const [path, sha] of currentSha) {
    // A repository file this device could not read is neither overwritten nor removed.
    if (remote.get(path) === sha || skipped.has(path)) continue
    const data = current.get(path)!
    if (known.has(sha)) {
      write.set(path, sha)
    } else if (typeof data === 'string' && data.length <= INLINE_FILE_LIMIT && inlineBytes + data.length <= INLINE_TOTAL_LIMIT) {
      inline.set(path, data)
      inlineBytes += data.length
    } else {
      write.set(path, await api.createBlob(data))
    }
  }
  if (!initialised) inline.set(MARKER_PATH, MARKER_CONTENT)
  // Only deletions that were planned as such.
  const remove = plan.deleteRemote.filter((path) => !currentSha.has(path) && remote.has(path))
  const pushed = write.size + inline.size + remove.length - (initialised ? 0 : 1)
  if (write.size + inline.size + remove.length > 0) {
    await api.commit({ parent: head?.commit ?? null, baseTree: head?.tree ?? null, write, inline, remove, message: COMMIT_MESSAGE })
  }

  // 3. Remember what both sides now agree on.
  const agreed = new Map(currentSha)
  for (const path of skipped) {
    const before = base.get(path)
    if (before === undefined) agreed.delete(path)
    else agreed.set(path, before)
  }
  await saveSyncState(api.id, agreed)
  return { pushed, pulled, conflicts: noted }
}

/**
 * One synchronisation with the repository. Safe to repeat: a run that fails
 * anywhere leaves local data intact and the next run picks up where things stand.
 */
export async function runSync(api: RemoteApi, options: SyncOptions = {}): Promise<SyncResult> {
  const noted: ConflictNote[] = []
  for (let attempt = 1; ; attempt++) {
    try {
      return await once(api, options, noted)
    } catch (error) {
      // Another device pushed in the meantime: look again and retry.
      if (!(error instanceof GitHubError) || error.kind !== 'conflict' || attempt >= MAX_ATTEMPTS) throw error
    }
  }
}
