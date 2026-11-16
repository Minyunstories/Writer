export const MAX_IMAGE_SIDE = 1600

/** Scales a size down so its longest side is at most max. Never scales up. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export interface PreparedImage {
  type: string
  data: ArrayBuffer
  width: number
  height: number
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** Decodes an image file, shrinks it to at most 1600 px and re-encodes it compactly. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_SIDE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.drawImage(bitmap, 0, 0, width, height)
    let blob = await encode(canvas, 'image/webp', 0.85)
    if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', 0.85)
    if (!blob) throw new Error('Image could not be encoded')
    return { type: blob.type, data: await blob.arrayBuffer(), width, height }
  } finally {
    bitmap.close()
  }
}
