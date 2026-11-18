import type { ChapterStatus } from '../types'

export const STATUSES: { id: ChapterStatus; label: string }[] = [
  { id: 'idea', label: 'Idee' },
  { id: 'draft', label: 'Entwurf' },
  { id: 'revision', label: 'Überarbeitung' },
  { id: 'done', label: 'Fertig' },
]

export const isStatus = (value: unknown): value is ChapterStatus => STATUSES.some((status) => status.id === value)
export const statusLabel = (status: ChapterStatus | undefined) => STATUSES.find((entry) => entry.id === status)?.label
