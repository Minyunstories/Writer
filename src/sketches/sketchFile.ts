import { extraOf, isObject, readJson, str, withExtra, type Raw } from '../lib/fileFields'
import type { FileData } from '../sync/hash'
import type { Sketch, SketchStamp, SketchStroke } from '../types'
import { SKETCH_COLORS } from './geometry'

const TOP_KEYS = ['id', 'name', 'createdAt', 'updatedAt', 'strokes', 'stamps', 'deleted']
const STROKE_KEYS = ['id', 'color', 'width', 'points', 'createdAt']
const STAMP_KEYS = ['id', 'stamp', 'x', 'y', 'size', 'color', 'entry', 'label', 'createdAt', 'updatedAt']

/** One decimal is plenty for a sketch and keeps the file small. */
const round = (value: number) => Math.round(value * 10) / 10
const level = (value: unknown): 1 | 2 | 3 => (value === 1 || value === 3 ? value : 2)
const byAge = <T extends { createdAt: number; id: string }>(a: T, b: T) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)

/**
 * sketches/<id>.json: the sketch's own fields as usual, then strokes and stamps in drawing order, one per line,
 * so a sketch with thousands of points stays readable and the same data always gives the same bytes.
 */
export function sketchFile(sketch: Sketch): string {
  const top: Raw = withExtra({ id: sketch.id, name: sketch.name, createdAt: sketch.createdAt, updatedAt: sketch.updatedAt }, sketch.extra)
  const strokes = [...sketch.strokes].sort(byAge).map((stroke) =>
    withExtra({ id: stroke.id, color: stroke.color, width: stroke.width, points: stroke.points.map(round), createdAt: stroke.createdAt }, stroke.extra),
  )
  const stamps = [...sketch.stamps].sort(byAge).map((stamp) =>
    withExtra(
      {
        id: stamp.id,
        stamp: stamp.stamp,
        x: round(stamp.x),
        y: round(stamp.y),
        size: stamp.size,
        color: stamp.color,
        ...(stamp.entryId ? { entry: stamp.entryId } : {}),
        createdAt: stamp.createdAt,
        updatedAt: stamp.updatedAt,
        // After the dates: where an older version, which keeps it as an unknown field, writes it too.
        ...(stamp.label ? { label: stamp.label } : {}),
      },
      stamp.extra,
    ),
  )
  const list = (items: Raw[]) => (items.length ? `[\n${items.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]` : '[]')
  const lines = Object.entries(top).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
  lines.push(`  "strokes": ${list(strokes)}`, `  "stamps": ${list(stamps)}`)
  if (sketch.deleted?.length) lines.push(`  "deleted": ${JSON.stringify([...sketch.deleted].sort())}`)
  return `{\n${lines.join(',\n')}\n}\n`
}

function parseStroke(raw: unknown): SketchStroke[] {
  if (!isObject(raw) || !str(raw.id) || !Array.isArray(raw.points)) return []
  const points = raw.points.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (points.length < 2 || points.length % 2) return []
  const stroke: SketchStroke = { id: raw.id, color: str(raw.color) ? raw.color : SKETCH_COLORS[0].value, width: level(raw.width), points, createdAt: Number(raw.createdAt) || 0 }
  const extra = extraOf(raw, STROKE_KEYS)
  return [extra ? { ...stroke, extra } : stroke]
}

/** A stamp label that an older version kept as an unknown field (`extra.label`), back where it belongs. */
export function normalizeStamp(stamp: SketchStamp): SketchStamp {
  const kept = stamp.extra?.label
  if (typeof kept !== 'string') return stamp
  const { label: _label, ...rest } = stamp.extra!
  const next: SketchStamp = { ...stamp, ...(stamp.label || !kept.trim() ? {} : { label: kept }) }
  if (Object.keys(rest).length) next.extra = rest
  else delete next.extra
  return next
}

/** All stamps of a sketch normalised; the same object when nothing needed it. */
export function normalizeSketch(sketch: Sketch): Sketch {
  const stamps = sketch.stamps.map(normalizeStamp)
  return stamps.some((stamp, i) => stamp !== sketch.stamps[i]) ? { ...sketch, stamps } : sketch
}

function parseStamp(raw: unknown): SketchStamp[] {
  if (!isObject(raw) || !str(raw.id) || !str(raw.stamp) || typeof raw.x !== 'number' || typeof raw.y !== 'number') return []
  const stamp: SketchStamp = {
    id: raw.id,
    stamp: raw.stamp,
    x: raw.x,
    y: raw.y,
    size: level(raw.size),
    color: str(raw.color) ? raw.color : SKETCH_COLORS[0].value,
    ...(str(raw.entry) ? { entryId: raw.entry } : {}),
    ...(str(raw.label) && raw.label.trim() ? { label: raw.label } : {}),
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  }
  const extra = extraOf(raw, STAMP_KEYS)
  return [extra ? { ...stamp, extra } : stamp]
}

/** The usable content of a sketch file; null when it is not an object. Half-broken items are skipped. */
export function parseSketch(data: FileData | undefined, id: string): Sketch | null {
  const value = readJson(data)
  if (!isObject(value)) return null
  const sketch: Sketch = {
    id,
    name: str(value.name) ? value.name : 'Skizze',
    strokes: Array.isArray(value.strokes) ? value.strokes.flatMap(parseStroke) : [],
    stamps: Array.isArray(value.stamps) ? value.stamps.flatMap(parseStamp) : [],
    createdAt: Number(value.createdAt) || 0,
    updatedAt: Number(value.updatedAt) || 0,
  }
  const deleted = Array.isArray(value.deleted) ? value.deleted.filter(str) : []
  if (deleted.length) sketch.deleted = deleted
  const extra = extraOf(value, TOP_KEYS)
  if (extra) sketch.extra = extra
  return sketch
}

/** Both devices' drawing: every stroke and stamp from either side, removed ones stay removed, the newer stamp and name win. */
export function mergeSketch(local: Sketch, remote: Sketch): Sketch {
  const deleted = new Set([...(local.deleted ?? []), ...(remote.deleted ?? [])])
  const strokes = new Map<string, SketchStroke>()
  for (const stroke of [...local.strokes, ...remote.strokes]) if (!deleted.has(stroke.id) && !strokes.has(stroke.id)) strokes.set(stroke.id, stroke)
  const stamps = new Map<string, SketchStamp>()
  for (const stamp of [...local.stamps, ...remote.stamps]) {
    if (deleted.has(stamp.id)) continue
    const known = stamps.get(stamp.id)
    if (!known || stamp.updatedAt > known.updatedAt) stamps.set(stamp.id, stamp)
  }
  const newer = remote.updatedAt > local.updatedAt ? remote : local
  const merged: Sketch = {
    ...newer,
    strokes: [...strokes.values()].sort(byAge),
    stamps: [...stamps.values()].sort(byAge),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  }
  if (deleted.size) merged.deleted = [...deleted]
  else delete merged.deleted
  return merged
}
