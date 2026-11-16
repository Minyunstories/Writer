export interface SyncSettings {
  owner: string
  repo: string
  token: string
}

const KEY = 'mw.sync'

/** Reads "owner/name" or a GitHub link. */
export function parseRepository(input: string): { owner: string; repo: string } | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^github\.com\//i, '')
  const [owner, rawRepo] = cleaned.split('/')
  const repo = rawRepo?.replace(/\.git$/i, '')
  const valid = /^[A-Za-z0-9._-]+$/
  if (!owner || !repo || !valid.test(owner) || !valid.test(repo)) return null
  return { owner, repo }
}

/** Shows only the last four characters of a token. */
export function maskToken(token: string): string {
  return `••••${token.slice(-4)}`
}

export function loadSettings(): SyncSettings | null {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SyncSettings> | null
    if (stored && stored.owner && stored.repo && stored.token) {
      return { owner: stored.owner, repo: stored.repo, token: stored.token }
    }
  } catch {
    // Unreadable settings count as none.
  }
  return null
}

/** The token stays in this browser only. */
export function saveSettings(settings: SyncSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings))
}

export function clearSettings(): void {
  localStorage.removeItem(KEY)
}
