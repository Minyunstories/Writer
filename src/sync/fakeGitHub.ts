import type { FileSet } from './files'
import { GitHubError, type GitHubErrorKind, type RemoteApi } from './github'
import { gitBlobSha, toBytes } from './hash'
import type { ShaMap } from './plan'

/** An in-memory stand-in for one GitHub repository. Used by tests and the browser check. */
export function createFakeGitHub(id = 'fake/repository'): RemoteApi & {
  /** The book files of the latest commit (without the sync marker); text decoded, images as bytes. */
  files(): Promise<FileSet>
  /** Makes one upcoming call fail: the next one, or the one after `after` successful calls. */
  failNext(kind: GitHubErrorKind, after?: number): void
  readonly commits: number
} {
  const blobs = new Map<string, Uint8Array>()
  const trees = new Map<string, ShaMap>()
  let head: { commit: string; tree: string } | null = null
  let commitCount = 0
  let failure: { kind: GitHubErrorKind; countdown: number } | null = null

  const gate = () => {
    if (!failure) return
    if (failure.countdown-- > 0) return
    const { kind } = failure
    failure = null
    throw new GitHubError(kind, `fake ${kind}`)
  }

  const storeTree = async (files: ShaMap) => {
    const sha = await gitBlobSha(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b))))
    trees.set(sha, new Map(files))
    return sha
  }

  return {
    id,
    get commits() {
      return commitCount
    },
    failNext(kind, after = 0) {
      failure = { kind, countdown: after }
    },
    async files() {
      const result: FileSet = new Map()
      if (!head) return result
      for (const [path, sha] of trees.get(head.tree)!) {
        if (path.startsWith('books/.')) continue
        const bytes = blobs.get(sha)!
        result.set(path, path.includes('/_images/') ? bytes : new TextDecoder().decode(bytes))
      }
      return result
    },
    async getHead() {
      gate()
      return head && { ...head }
    },
    async getTree(tree) {
      gate()
      const found = trees.get(tree)
      if (!found) throw new GitHubError('not-found', 'no such tree', 404)
      return new Map(found)
    },
    async getBlob(sha) {
      gate()
      const found = blobs.get(sha)
      if (!found) throw new GitHubError('not-found', 'no such blob', 404)
      return found.slice()
    },
    async createBlob(data) {
      gate()
      const sha = await gitBlobSha(data)
      blobs.set(sha, toBytes(data).slice())
      return sha
    },
    async commit({ parent, baseTree, write, inline, remove }) {
      gate()
      if ((head?.commit ?? null) !== parent) throw new GitHubError('conflict', 'branch moved', 422)
      const files: ShaMap = new Map(baseTree ? trees.get(baseTree) : [])
      for (const path of remove) files.delete(path)
      for (const [path, sha] of write) {
        if (!blobs.has(sha)) throw new GitHubError('other', `unknown blob ${sha}`, 422)
        files.set(path, sha)
      }
      for (const [path, content] of inline) {
        const sha = await gitBlobSha(content)
        blobs.set(sha, toBytes(content).slice())
        files.set(path, sha)
      }
      const tree = await storeTree(files)
      commitCount++
      head = { commit: `commit-${commitCount}-${tree.slice(0, 8)}`, tree }
      return { ...head }
    },
  }
}
