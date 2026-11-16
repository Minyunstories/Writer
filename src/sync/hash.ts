export type FileData = string | Uint8Array

const encoder = new TextEncoder()

export function toBytes(data: FileData): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data
}

/** The hash Git gives a file with this content (SHA-1 over "blob <length>\0<content>"). */
export async function gitBlobSha(data: FileData): Promise<string> {
  const bytes = toBytes(data)
  const header = encoder.encode(`blob ${bytes.byteLength}\0`)
  const all = new Uint8Array(header.byteLength + bytes.byteLength)
  all.set(header, 0)
  all.set(bytes, header.byteLength)
  const digest = await crypto.subtle.digest('SHA-1', all)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
