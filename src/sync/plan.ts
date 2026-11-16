export type ShaMap = Map<string, string>

export interface Plan {
  /** Changed or new here: upload. */
  push: string[]
  /** Changed or new in the repository: download. */
  pull: string[]
  /** Deleted here, untouched in the repository. */
  deleteRemote: string[]
  /** Deleted in the repository, untouched here. */
  deleteLocal: string[]
  /** Changed differently on both sides. */
  conflicts: string[]
}

/**
 * Compares the files here and in the repository against the last synced state.
 * A change always beats a deletion, so nothing written is ever dropped.
 */
export function planSync(base: ShaMap, local: ShaMap, remote: ShaMap): Plan {
  const plan: Plan = { push: [], pull: [], deleteRemote: [], deleteLocal: [], conflicts: [] }
  const paths = [...new Set([...base.keys(), ...local.keys(), ...remote.keys()])].sort()

  for (const path of paths) {
    const b = base.get(path)
    const l = local.get(path)
    const r = remote.get(path)
    if (l === r) continue
    if (l === undefined) {
      // Missing here: deleted here (if the repository is untouched) or new there.
      if (r === b) plan.deleteRemote.push(path)
      else plan.pull.push(path)
    } else if (r === undefined) {
      if (l === b) plan.deleteLocal.push(path)
      else plan.push.push(path)
    } else if (r === b) {
      plan.push.push(path)
    } else if (l === b) {
      plan.pull.push(path)
    } else {
      plan.conflicts.push(path)
    }
  }
  return plan
}

/**
 * A book is never left half-deleted. If one side deleted a book while the other
 * side changed something in it, the deletion is undone for the whole book.
 */
export function keepBooksWhole(plan: Plan, bookOf: (path: string) => string | null): Plan {
  const alive = new Set<string>()
  for (const path of [...plan.push, ...plan.pull, ...plan.conflicts]) {
    const book = bookOf(path)
    if (book) alive.add(book)
  }
  const next: Plan = { ...plan, push: [...plan.push], pull: [...plan.pull], deleteLocal: [], deleteRemote: [] }
  for (const path of plan.deleteLocal) {
    const book = bookOf(path)
    // Deleted in the repository but still worked on here: upload it again.
    if (book && alive.has(book) && isBookFile(path, book, plan.deleteLocal)) next.push.push(path)
    else next.deleteLocal.push(path)
  }
  for (const path of plan.deleteRemote) {
    const book = bookOf(path)
    // Deleted here but changed in the repository: fetch it again.
    if (book && alive.has(book) && isBookFile(path, book, plan.deleteRemote)) next.pull.push(path)
    else next.deleteRemote.push(path)
  }
  next.push.sort()
  next.pull.sort()
  return next
}

/** True when this deletion is part of deleting the whole book (its book.json goes too). */
function isBookFile(_path: string, book: string, deletions: string[]): boolean {
  return deletions.includes(`books/${book}/book.json`)
}
