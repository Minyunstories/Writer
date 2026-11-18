import { useEffect, useState } from 'react'
import { STATUSES } from '../lib/chapterStatus'
import { setChapterStatus } from '../storage/db'
import type { Chapter, ChapterStatus } from '../types'

interface Props {
  chapter: Pick<Chapter, 'id' | 'title' | 'status'>
  onChanged: () => void
}

/** How far a chapter is: idea, draft, revision, done. */
export function StatusPicker({ chapter, onChanged }: Props) {
  const [status, setStatus] = useState<ChapterStatus | ''>(chapter.status ?? '')
  const [failed, setFailed] = useState(false)
  useEffect(() => setStatus(chapter.status ?? ''), [chapter.status])

  return (
    <label className={`status-picker status-${status || 'none'}`} title={failed ? 'Konnte nicht gespeichert werden' : 'Wie weit ist das Kapitel?'}>
      <span className="status-dot" aria-hidden="true" />
      <select
        aria-label={`Status von „${chapter.title}“`}
        value={status}
        onChange={(event) => {
          const next = event.target.value as ChapterStatus | ''
          setStatus(next)
          setChapterStatus(chapter.id, next || null).then(
            () => {
              setFailed(false)
              onChanged()
            },
            () => setFailed(true),
          )
        }}
      >
        <option value="">Ohne Status</option>
        {STATUSES.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  )
}
