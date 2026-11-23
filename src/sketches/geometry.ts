import type { Sketch, SketchStamp, SketchStroke } from '../types'

/** Pen widths 1–3 (fein, mittel, dick) in world units. */
export const STROKE_WIDTHS = { 1: 1.5, 2: 3, 3: 6 } as const
/** Stamp sizes 1–3 (S, M, L): edge length in world units. */
export const STAMP_SIZES = { 1: 24, 2: 40, 3: 64 } as const

/** Six pen colours that read well on the dark canvas; the first is the text colour. */
export const SKETCH_COLORS = [
  { name: 'Hell', value: '#d9d1c6' },
  { name: 'Kupfer', value: '#d58d62' },
  { name: 'Gold', value: '#d9b26a' },
  { name: 'Grün', value: '#8fbf8a' },
  { name: 'Blau', value: '#7fa8d1' },
  { name: 'Rot', value: '#e0796a' },
] as const

export type View = { x: number; y: number; scale: number }
export type Box = { left: number; top: number; right: number; bottom: number }

export const MIN_SCALE = 0.1
export const MAX_SCALE = 8
export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/** Same rounding as the sketch file, so what is shown equals what is stored. */
export const round = (value: number) => Math.round(value * 10) / 10

/** SVG path of a stroke; a single point becomes a dot (round caps). */
export function strokePath(points: readonly number[]): string {
  if (points.length < 2) return ''
  let d = `M${points[0]} ${points[1]}`
  if (points.length === 2) return `${d}l0 0`
  for (let i = 2; i + 1 < points.length; i += 2) d += `L${points[i]} ${points[i + 1]}`
  return d
}

const boxes = new WeakMap<SketchStroke, Box>()

/** Bounding box of a stroke's points (cached per stroke object). */
export function strokeBox(stroke: SketchStroke): Box {
  const known = boxes.get(stroke)
  if (known) return known
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (let i = 0; i + 1 < stroke.points.length; i += 2) {
    box.left = Math.min(box.left, stroke.points[i])
    box.right = Math.max(box.right, stroke.points[i])
    box.top = Math.min(box.top, stroke.points[i + 1])
    box.bottom = Math.max(box.bottom, stroke.points[i + 1])
  }
  boxes.set(stroke, box)
  return box
}

export function stampBox(stamp: SketchStamp): Box {
  const half = STAMP_SIZES[stamp.size] / 2
  return { left: stamp.x - half, top: stamp.y - half, right: stamp.x + half, bottom: stamp.y + half }
}

const inside = (box: Box, x: number, y: number, margin = 0) => x >= box.left - margin && x <= box.right + margin && y >= box.top - margin && y <= box.bottom + margin

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Whether a point (world units) lies within `radius` of the drawn line. */
export function hitsStroke(stroke: SketchStroke, x: number, y: number, radius: number): boolean {
  const reach = radius + STROKE_WIDTHS[stroke.width] / 2
  if (!inside(strokeBox(stroke), x, y, reach)) return false
  const p = stroke.points
  if (p.length < 4) return Math.hypot(x - p[0], y - p[1]) <= reach
  for (let i = 0; i + 3 < p.length; i += 2) if (segmentDistance(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true
  return false
}

/** The topmost stamp at a point, if any. */
export function stampAt(stamps: readonly SketchStamp[], x: number, y: number, margin = 0): SketchStamp | undefined {
  for (let i = stamps.length - 1; i >= 0; i--) if (inside(stampBox(stamps[i]), x, y, margin)) return stamps[i]
  return undefined
}

/** Box around everything drawn, or null for an empty sketch. */
export function contentBox(sketch: Pick<Sketch, 'strokes' | 'stamps'>): Box | null {
  const all = [...sketch.strokes.filter((stroke) => stroke.points.length >= 2).map(strokeBox), ...sketch.stamps.map(stampBox)]
  if (!all.length) return null
  return {
    left: Math.min(...all.map((box) => box.left)),
    top: Math.min(...all.map((box) => box.top)),
    right: Math.max(...all.map((box) => box.right)),
    bottom: Math.max(...all.map((box) => box.bottom)),
  }
}

/** A view showing the whole box in a canvas of the given size; never zoomed in beyond 1, empty → origin in the middle. */
export function fitView(box: Box | null, width: number, height: number): View {
  if (!box) return { x: width / 2, y: height / 2, scale: 1 }
  const pad = 40
  const scale = clampScale(Math.min(1, (width - 2 * pad) / Math.max(1, box.right - box.left), (height - 2 * pad) / Math.max(1, box.bottom - box.top)))
  return { scale, x: width / 2 - ((box.left + box.right) / 2) * scale, y: height / 2 - ((box.top + box.bottom) / 2) * scale }
}

/** A view with the given world point in the middle, keeping the zoom. */
export const centerOn = (point: { x: number; y: number }, view: View, width: number, height: number): View => ({
  scale: view.scale,
  x: width / 2 - point.x * view.scale,
  y: height / 2 - point.y * view.scale,
})
