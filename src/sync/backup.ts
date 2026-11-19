import { zipSync, type Zippable } from 'fflate'
import { readLocalFiles } from './local'

const pad = (value: number) => String(value).padStart(2, '0')

/** Writer-Sicherung-2026-11-19.zip, by the local date. */
export function backupName(date: Date): string {
  return `Writer-Sicherung-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`
}

/**
 * Everything the sync writes – books, collection, named versions, trash – as one zip, in the same
 * folders as the books repository. Settings (and with them the access token) are never part of it.
 */
export async function buildBackup(): Promise<Uint8Array> {
  const files = await readLocalFiles()
  const encoder = new TextEncoder()
  const zippable: Zippable = {}
  for (const [path, data] of files) zippable[path] = typeof data === 'string' ? encoder.encode(data) : data
  return zipSync(zippable)
}

/** Packs the backup and hands it to the browser as a download. */
export async function downloadBackup(now = new Date()): Promise<void> {
  const zip = await buildBackup()
  // fflate hands back a fresh array over its own ArrayBuffer.
  const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = backupName(now)
  document.body.append(link)
  link.click()
  link.remove()
  // Some browsers start the download only after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
