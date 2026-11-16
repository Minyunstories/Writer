import { toBytes, type FileData } from './hash'
import type { ShaMap } from './plan'

export type GitHubErrorKind = 'auth' | 'not-found' | 'offline' | 'rate-limit' | 'conflict' | 'other'

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

export interface CommitInput {
  /** The commit this one follows; null for a repository without commits. */
  parent: string | null
  baseTree: string | null
  /** Files whose content was uploaded as a blob before: path to blob hash. */
  write: Map<string, string>
  /** Text files sent inside the commit itself: path to content. */
  inline: Map<string, string>
  remove: string[]
  message: string
}

export interface RemoteApi {
  /** Identifies the repository, e.g. "owner/name". What was synced is remembered per repository. */
  readonly id: string
  /** Latest commit and its tree, or null for an empty repository. */
  getHead(): Promise<{ commit: string; tree: string } | null>
  /** All files of a tree: path to blob hash. */
  getTree(tree: string): Promise<ShaMap>
  getBlob(sha: string): Promise<Uint8Array>
  createBlob(data: FileData): Promise<string>
  /** Rejects with kind 'conflict' when the branch moved in the meantime. Never forces. */
  commit(input: CommitInput): Promise<{ commit: string; tree: string }>
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const README = `# Writer

Dieses Repository enthält Bücher aus Writer. Die App schreibt und liest den Ordner \`books/\`.
Die Dateien sind normales Markdown und JSON und bleiben auch ohne die App lesbar.
`

export function createGitHubApi(config: { owner: string; repo: string; token: string; fetch?: typeof fetch }): RemoteApi {
  const doFetch = config.fetch ?? ((input, init) => fetch(input, init))
  const root = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`
  let branch: string | undefined

  async function request<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<{ status: number; data: T }> {
    let response: Response
    try {
      response = await doFetch(`${root}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      })
    } catch {
      throw new GitHubError('offline', 'GitHub ist nicht erreichbar')
    }
    if (response.ok || okStatuses.includes(response.status)) {
      const data = (await response.json().catch(() => ({}))) as T
      return { status: response.status, data }
    }
    const { status } = response
    const detail = (await response.json().catch(() => null)) as { message?: string } | null
    // GitHub's secondary limits answer 403 without the usual headers; the message gives them away.
    const limited =
      status === 429 ||
      (status === 403 &&
        (response.headers.get('x-ratelimit-remaining') === '0' ||
          response.headers.has('retry-after') ||
          /rate limit|abuse/i.test(detail?.message ?? '')))
    const kind: GitHubErrorKind = limited ? 'rate-limit' : status === 401 || status === 403 ? 'auth' : status === 404 ? 'not-found' : 'other'
    throw new GitHubError(kind, `GitHub antwortet mit ${status}`, status)
  }

  async function defaultBranch(): Promise<string> {
    if (!branch) branch = (await request<{ default_branch?: string }>('GET', '')).data.default_branch || 'main'
    return branch
  }

  const api: RemoteApi = {
    id: `${config.owner}/${config.repo}`.toLowerCase(),

    async getHead() {
      const name = await defaultBranch()
      // 404: no such branch yet; 409: the repository has no commits.
      const ref = await request<{ object?: { sha: string } }>('GET', `/git/ref/heads/${name}`, undefined, [404, 409])
      if (ref.status !== 200 || !ref.data.object) return null
      const commit = ref.data.object.sha
      const detail = await request<{ tree: { sha: string } }>('GET', `/git/commits/${commit}`)
      return { commit, tree: detail.data.tree.sha }
    },

    async getTree(tree) {
      const { data } = await request<{ truncated?: boolean; tree: { path: string; type: string; sha: string }[] }>(
        'GET',
        `/git/trees/${tree}?recursive=1`,
      )
      if (data.truncated) throw new GitHubError('other', 'Das Repository ist zu groß für eine vollständige Abfrage')
      return new Map(data.tree.filter((item) => item.type === 'blob').map((item) => [item.path, item.sha]))
    },

    async getBlob(sha) {
      const { data } = await request<{ content: string; encoding: string }>('GET', `/git/blobs/${sha}`)
      return data.encoding === 'base64' ? fromBase64(data.content) : new TextEncoder().encode(data.content)
    },

    async createBlob(data) {
      const result = await request<{ sha: string }>('POST', '/git/blobs', { content: toBase64(toBytes(data)), encoding: 'base64' })
      return result.data.sha
    },

    async commit({ parent, baseTree, write, inline, remove, message }) {
      const name = await defaultBranch()
      if (parent === null) {
        // The Git Data API refuses repositories without commits; start one with a README.
        await request('PUT', '/contents/README.md', { message: 'Writer einrichten', content: toBase64(toBytes(README)), branch: name })
        const head = await api.getHead()
        if (!head) throw new GitHubError('other', 'Das Repository konnte nicht eingerichtet werden')
        parent = head.commit
        baseTree = head.tree
      }
      const tree = await request<{ sha: string }>('POST', '/git/trees', {
        base_tree: baseTree,
        tree: [
          ...[...write].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha })),
          ...[...inline].map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
          ...remove.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
        ],
      })
      const commit = await request<{ sha: string }>('POST', '/git/commits', { message, tree: tree.data.sha, parents: [parent] })
      try {
        await request('PATCH', `/git/refs/heads/${name}`, { sha: commit.data.sha, force: false })
      } catch (error) {
        if (error instanceof GitHubError && (error.status === 422 || error.status === 409)) {
          throw new GitHubError('conflict', 'Das Repository wurde inzwischen geändert', error.status)
        }
        throw error
      }
      return { commit: commit.data.sha, tree: tree.data.sha }
    },
  }
  return api
}
