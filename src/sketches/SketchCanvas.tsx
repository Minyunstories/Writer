import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { addCustomStamp, deleteCustomStamp, renameCustomStamp } from '../storage/stamps'
import { addStamp, addStroke, removeItems, restoreItems, updateStamp, type StampPatch } from '../storage/sketches'
import type { CustomStamp, Sketch, SketchStamp, SketchStroke, WikiEntry } from '../types'
import { ConfirmDialog } from '../ui/Dialogs'
import { BUILTIN_STAMPS, BUILTIN_VIEWBOX, builtinStamp } from './builtinStamps'
import { centerOn, clampScale, contentBox, fitView, hitsStroke, round, SKETCH_COLORS, stampAt, STAMP_SIZES, STROKE_WIDTHS, strokePath, type View } from './geometry'
import { sanitizeSvg } from './sanitizeSvg'
import './sketches.css'

type Tool = 'pen' | 'eraser' | 'stamp' | 'select' | 'hand'
type Level = 1 | 2 | 3

export type SketchCanvasProps = {
  bookId: string
  sketch: Sketch
  entries: WikiEntry[]
  stamps: CustomStamp[]
  editable: boolean
  /** A world point to show in the middle (from „Auf Skizzen“ in a wiki entry). */
  focus?: { x: number; y: number } | null
  onOpenEntry(id: string): void
  onChanged(): void
}

/** One undoable step: items added or erased (present = there after the step), or a stamp changed. */
type Step =
  | { kind: 'items'; present: boolean; strokes: SketchStroke[]; stamps: SketchStamp[] }
  | { kind: 'stamp'; id: string; before: StampPatch; after: StampPatch }

type Gesture =
  | { kind: 'pan'; start: { x: number; y: number }; origin: View; moved: boolean; tap?: SketchStamp }
  | { kind: 'draw'; points: number[] }
  | { kind: 'erase'; hits: Set<string> }
  | { kind: 'place'; x: number; y: number }
  | { kind: 'drag'; id: string; start: { x: number; y: number }; origin: { x: number; y: number }; moved: boolean; at?: { x: number; y: number } }

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: 'pen', label: 'Stift', title: 'Stift: mit Stift oder Maus zeichnen' },
  { id: 'eraser', label: 'Radierer', title: 'Radierer: entfernt ganze Striche und Stempel' },
  { id: 'stamp', label: 'Stempel', title: 'Stempel setzen' },
  { id: 'select', label: 'Auswählen', title: 'Stempel auswählen: verschieben, Größe, verknüpfen' },
  { id: 'hand', label: 'Hand', title: 'Verschieben; verknüpfte Stempel öffnen' },
]
const WIDTHS: { level: Level; label: string }[] = [
  { level: 1, label: 'Fein' },
  { level: 2, label: 'Mittel' },
  { level: 3, label: 'Dick' },
]
const SIZES: { level: Level; label: string }[] = [
  { level: 1, label: 'S' },
  { level: 2, label: 'M' },
  { level: 3, label: 'L' },
]
/** Screen pixels a press may wander and still count as a tap. */
const TAP = 5
/** Screen pixels between two kept points of a stroke. */
const STEP = 1.5
/** Screen pixels the eraser reaches. */
const ERASER = 6

/** A cleaned own stamp, ready to draw inside an <svg>. */
type Prepared = { viewBox: string; inner: string }
function prepare(stamp: CustomStamp): Prepared | null {
  // Cleaned again before showing: whatever arrives through the sync never reaches the page unchecked.
  const clean = sanitizeSvg(stamp.svg)
  return clean ? { viewBox: clean.viewBox, inner: clean.inner } : null
}

/** One stroke. Strokes never change once drawn, so only its id, look or being hidden (eraser) redraw it. */
const StrokePath = memo(
  function StrokePath({ stroke, hidden }: { stroke: SketchStroke; hidden: boolean }) {
    return <path className="sketch-stroke" d={strokePath(stroke.points)} stroke={stroke.color} strokeWidth={STROKE_WIDTHS[stroke.width]} visibility={hidden ? 'hidden' : undefined} />
  },
  (a, b) => a.hidden === b.hidden && a.stroke.id === b.stroke.id && a.stroke.color === b.stroke.color && a.stroke.width === b.stroke.width && a.stroke.points.length === b.stroke.points.length,
)

const Strokes = memo(function Strokes({ strokes, hidden }: { strokes: SketchStroke[]; hidden: ReadonlySet<string> }) {
  return (
    <g className="sketch-strokes">
      {strokes.map((stroke) => (
        <StrokePath key={stroke.id} stroke={stroke} hidden={hidden.has(stroke.id)} />
      ))}
    </g>
  )
})

function StampShape({ stamp, size, prepared }: { stamp: string; size: number; prepared?: Prepared | null }) {
  const builtin = builtinStamp(stamp)
  if (builtin)
    return (
      <svg x={-size / 2} y={-size / 2} width={size} height={size} viewBox={BUILTIN_VIEWBOX} aria-hidden="true">
        <path d={builtin.path} fill="currentColor" />
      </svg>
    )
  if (prepared) return <svg x={-size / 2} y={-size / 2} width={size} height={size} viewBox={prepared.viewBox} aria-hidden="true" dangerouslySetInnerHTML={{ __html: prepared.inner }} />
  // An own stamp deleted meanwhile (or not yet synced): a grey placeholder keeps its place.
  return <rect className="sketch-stamp-missing" x={-size / 2} y={-size / 2} width={size} height={size} rx={4} />
}

export function SketchCanvas({ bookId, sketch, entries, stamps, editable, focus, onOpenEntry, onChanged }: SketchCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<SVGPathElement>(null)

  // What is shown: the stored sketch plus this canvas's own changes until they are stored and reloaded.
  const [local, setLocal] = useState(sketch)
  const localRef = useRef(local)
  localRef.current = local
  const inflight = useRef(0)
  useEffect(() => {
    if (inflight.current === 0) setLocal(sketch)
  }, [sketch])

  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [tool, setTool] = useState<Tool>(editable ? 'pen' : 'hand')
  const [width, setWidth] = useState<Level>(2)
  const [color, setColor] = useState<string>(SKETCH_COLORS[0].value)
  const [chosen, setChosen] = useState<string>(BUILTIN_STAMPS[0].id)
  const [selected, setSelected] = useState<string | null>(null)
  const [erasing, setErasing] = useState<ReadonlySet<string>>(new Set())
  const [dragged, setDragged] = useState<{ id: string; x: number; y: number } | null>(null)
  const [manage, setManage] = useState(false)
  const [removing, setRemoving] = useState<CustomStamp | null>(null)
  const [message, setMessage] = useState('')
  const [, setVersion] = useState(0)

  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; view: View; center: { x: number; y: number } } | null>(null)
  const space = useRef(false)

  // Undo history of this canvas since opening. Undoing an erase re-adds copies with new ids, so ids are
  // followed through `remap` (old → newest) and recorded by their first id (`origin`).
  const undo = useRef<Step[]>([])
  const redo = useRef<Step[]>([])
  const remap = useRef(new Map<string, string>())
  const origin = useRef(new Map<string, string>())
  const resolve = (id: string) => {
    let current = id
    for (let i = 0; i < 8 && remap.current.has(current); i++) current = remap.current.get(current)!
    return current
  }
  const canonical = (id: string) => origin.current.get(resolve(id)) ?? resolve(id)

  const queue = useRef<Promise<void>>(Promise.resolve())
  const run = useCallback(
    (task: () => Promise<void>) => {
      inflight.current++
      queue.current = queue.current
        .then(task)
        .catch(() => setMessage('Das hat nicht geklappt. Bitte noch einmal versuchen.'))
        .finally(() => {
          inflight.current--
          setVersion((v) => v + 1)
          onChanged()
        })
    },
    [onChanged],
  )

  const size = () => {
    const box = svgRef.current?.getBoundingClientRect()
    return { left: box?.left ?? 0, top: box?.top ?? 0, width: box?.width || 800, height: box?.height || 600 }
  }
  const toWorld = (clientX: number, clientY: number) => {
    const { left, top } = size()
    const current = viewRef.current
    return { x: (clientX - left - current.x) / current.scale, y: (clientY - top - current.y) / current.scale }
  }
  /** Sets the view at once for the handlers too, not only with the next render. */
  const show = (next: View) => {
    viewRef.current = next
    setView(next)
  }
  const fit = () => {
    const { width: w, height: h } = size()
    show(fitView(contentBox(localRef.current), w, h))
  }

  // Another sketch: fresh history, everything in view (before the first paint, so nothing jumps).
  useLayoutEffect(() => {
    undo.current = []
    redo.current = []
    remap.current.clear()
    origin.current.clear()
    setSelected(null)
    setLocal(sketch)
    localRef.current = sketch
    fit()
  }, [sketch.id])

  useEffect(() => {
    if (!focus) return
    const { width: w, height: h } = size()
    show(centerOn(focus, { ...viewRef.current, scale: Math.max(viewRef.current.scale, 1) }, w, h))
  }, [focus])

  // Wheel zoom around the pointer (a native listener: React's wheel listener cannot prevent scrolling).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const { left, top } = size()
      const cx = event.clientX - left
      const cy = event.clientY - top
      const current = viewRef.current
      const scale = clampScale(current.scale * Math.exp(-event.deltaY * 0.0015))
      const factor = scale / current.scale
      show({ scale, x: cx - (cx - current.x) * factor, y: cy - (cy - current.y) * factor })
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [])

  const names = useMemo(() => new Map(entries.map((entry) => [entry.id, entry.name])), [entries])
  const sortedEntries = useMemo(() => [...entries].sort((a, b) => a.name.localeCompare(b.name, 'de')), [entries])
  const prepared = useMemo(() => new Map(stamps.map((stamp) => [`custom:${stamp.id}`, prepare(stamp)])), [stamps])

  const shownStamps = local.stamps
    .filter((stamp) => !erasing.has(stamp.id))
    .map((stamp) => (dragged?.id === stamp.id ? { ...stamp, x: dragged.x, y: dragged.y } : stamp))
  const selectedStamp = selected ? local.stamps.find((stamp) => stamp.id === selected) : undefined

  // ——— Changes (shown at once, stored in order) ———

  const pendingIds = useRef(0)
  const addStrokeHere = (points: number[]) => {
    const temp: SketchStroke = { id: `pending:${Date.now()}:${pendingIds.current++}`, color, width, points, createdAt: Date.now() }
    setLocal((current) => ({ ...current, strokes: [...current.strokes, temp] }))
    run(async () => {
      const saved = await addStroke(bookId, sketch.id, { color: temp.color, width: temp.width, points: temp.points, createdAt: temp.createdAt })
      remap.current.set(temp.id, saved.id)
      setLocal((current) => ({ ...current, strokes: current.strokes.map((stroke) => (stroke.id === temp.id ? saved : stroke)) }))
      pushStep({ kind: 'items', present: true, strokes: [saved], stamps: [] })
    })
  }

  const addStampHere = (x: number, y: number) => {
    const now = Date.now()
    const temp: SketchStamp = { id: `pending:${now}:${pendingIds.current++}`, stamp: chosen, x: round(x), y: round(y), size: 2, color, createdAt: now, updatedAt: now }
    setLocal((current) => ({ ...current, stamps: [...current.stamps, temp] }))
    run(async () => {
      const saved = await addStamp(bookId, sketch.id, { stamp: temp.stamp, x: temp.x, y: temp.y, size: temp.size, color: temp.color, createdAt: temp.createdAt })
      remap.current.set(temp.id, saved.id)
      setLocal((current) => ({ ...current, stamps: current.stamps.map((stamp) => (stamp.id === temp.id ? saved : stamp)) }))
      pushStep({ kind: 'items', present: true, strokes: [], stamps: [saved] })
    })
  }

  const erase = (ids: ReadonlySet<string>) => {
    if (!ids.size) return
    const gone = { strokes: localRef.current.strokes.filter((stroke) => ids.has(stroke.id)), stamps: localRef.current.stamps.filter((stamp) => ids.has(stamp.id)) }
    setLocal((current) => ({ ...current, strokes: current.strokes.filter((stroke) => !ids.has(stroke.id)), stamps: current.stamps.filter((stamp) => !ids.has(stamp.id)) }))
    if (selected && ids.has(selected)) setSelected(null)
    run(async () => {
      await removeItems(bookId, sketch.id, [...ids].map(resolve))
      pushStep({
        kind: 'items',
        present: false,
        strokes: gone.strokes.map((stroke) => ({ ...stroke, id: canonical(stroke.id) })),
        stamps: gone.stamps.map((stamp) => ({ ...stamp, id: canonical(stamp.id) })),
      })
    })
  }

  const changeStamp = (id: string, patch: StampPatch) => {
    const old = localRef.current.stamps.find((stamp) => stamp.id === id)
    if (!old) return
    const before: StampPatch = {}
    for (const key of Object.keys(patch) as (keyof StampPatch)[]) {
      if (key === 'entryId') before.entryId = old.entryId ?? null
      else (before as Record<string, unknown>)[key] = old[key]
    }
    if (Object.keys(patch).every((key) => (before as Record<string, unknown>)[key] === (patch as Record<string, unknown>)[key])) return
    setLocal((current) => ({
      ...current,
      stamps: current.stamps.map((stamp) => {
        if (stamp.id !== id) return stamp
        const next = { ...stamp, ...patch } as SketchStamp & { entryId?: string | null }
        if (next.entryId === null) delete next.entryId
        return next as SketchStamp
      }),
    }))
    run(async () => {
      await updateStamp(bookId, sketch.id, resolve(id), patch)
      pushStep({ kind: 'stamp', id: canonical(id), before, after: patch })
    })
  }

  function pushStep(step: Step) {
    undo.current.push(step)
    redo.current = []
  }

  /** Brings items back (copies with new ids) or takes them away again. */
  async function setPresent(step: Extract<Step, { kind: 'items' }>, present: boolean) {
    if (!present) return removeItems(bookId, sketch.id, [...step.strokes, ...step.stamps].map((item) => resolve(item.id)))
    const copies = await restoreItems(bookId, sketch.id, step.strokes, step.stamps)
    const pairs = [...step.strokes.map((item, i) => [item.id, copies.strokes[i].id]), ...step.stamps.map((item, i) => [item.id, copies.stamps[i].id])]
    for (const [first, copy] of pairs) {
      remap.current.set(first, copy)
      origin.current.set(copy, first)
    }
  }

  const history = (back: boolean) =>
    run(async () => {
      const step = (back ? undo : redo).current.pop()
      if (!step) return
      if (step.kind === 'items') await setPresent(step, back ? !step.present : step.present)
      else await updateStamp(bookId, sketch.id, resolve(step.id), back ? step.before : step.after)
      ;(back ? redo : undo).current.push(step)
    })

  // ——— Pointer ———

  const down = (event: ReactPointerEvent<SVGSVGElement>) => {
    wrapRef.current?.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const touch = event.pointerType === 'touch'
    if (touch && pointers.current.size === 2) {
      // Two fingers: zoom (and move) instead of whatever the first finger started.
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), view: viewRef.current, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
      gesture.current = null
      return
    }
    if (pointers.current.size > 1) return
    const point = toWorld(event.clientX, event.clientY)
    const pan = !editable || touch || event.button === 1 || space.current || tool === 'hand'
    if (pan) {
      const hit = stampAt(localRef.current.stamps, point.x, point.y)
      gesture.current = { kind: 'pan', start: { x: event.clientX, y: event.clientY }, origin: viewRef.current, moved: false, tap: hit?.entryId ? hit : undefined }
      return
    }
    if (event.button !== 0) return
    if (tool === 'pen') {
      const points = [round(point.x), round(point.y)]
      gesture.current = { kind: 'draw', points }
      liveRef.current?.setAttribute('d', strokePath(points))
    } else if (tool === 'eraser') {
      gesture.current = { kind: 'erase', hits: new Set() }
      eraseAt(point)
    } else if (tool === 'stamp') {
      gesture.current = { kind: 'place', x: point.x, y: point.y }
    } else if (tool === 'select') {
      const hit = stampAt(localRef.current.stamps, point.x, point.y)
      setSelected(hit?.id ?? null)
      gesture.current = hit
        ? { kind: 'drag', id: hit.id, start: { x: event.clientX, y: event.clientY }, origin: { x: hit.x, y: hit.y }, moved: false }
        : { kind: 'pan', start: { x: event.clientX, y: event.clientY }, origin: viewRef.current, moved: false }
    }
  }

  const eraseAt = (point: { x: number; y: number }) => {
    const active = gesture.current
    if (active?.kind !== 'erase') return
    const radius = ERASER / viewRef.current.scale
    const before = active.hits.size
    for (const stroke of localRef.current.strokes) if (!active.hits.has(stroke.id) && hitsStroke(stroke, point.x, point.y, radius)) active.hits.add(stroke.id)
    const stamp = stampAt(localRef.current.stamps, point.x, point.y, radius)
    if (stamp) active.hits.add(stamp.id)
    if (active.hits.size !== before) setErasing(new Set(active.hits))
  }

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const { left, top } = size()
      const start = pinch.current
      const scale = clampScale((start.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, start.distance))
      const cx = start.center.x - left
      const cy = start.center.y - top
      const now = { x: (a.x + b.x) / 2 - left, y: (a.y + b.y) / 2 - top }
      const factor = scale / start.view.scale
      show({ scale, x: now.x - (cx - start.view.x) * factor, y: now.y - (cy - start.view.y) * factor })
      return
    }
    const active = gesture.current
    if (!active) return
    if (active.kind === 'pan' || active.kind === 'drag') {
      const dx = event.clientX - active.start.x
      const dy = event.clientY - active.start.y
      if (!active.moved && Math.hypot(dx, dy) < TAP) return
      active.moved = true
      if (active.kind === 'pan') show({ ...active.origin, x: active.origin.x + dx, y: active.origin.y + dy })
      else {
        active.at = { x: round(active.origin.x + dx / viewRef.current.scale), y: round(active.origin.y + dy / viewRef.current.scale) }
        setDragged({ id: active.id, ...active.at })
      }
      return
    }
    const point = toWorld(event.clientX, event.clientY)
    if (active.kind === 'draw') {
      const p = active.points
      if (Math.hypot(point.x - p[p.length - 2], point.y - p[p.length - 1]) * viewRef.current.scale < STEP) return
      p.push(round(point.x), round(point.y))
      liveRef.current?.setAttribute('d', strokePath(p))
    } else if (active.kind === 'erase') eraseAt(point)
  }

  const up = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(event.pointerId)) return
    if (pointers.current.size < 2) pinch.current = null
    const active = gesture.current
    gesture.current = null
    if (!active) return
    if (active.kind === 'pan') {
      if (!active.moved && active.tap?.entryId) onOpenEntry(active.tap.entryId)
    } else if (active.kind === 'draw') {
      const point = toWorld(event.clientX, event.clientY)
      const p = active.points
      const last = [round(point.x), round(point.y)]
      if (last[0] !== p[p.length - 2] || last[1] !== p[p.length - 1]) p.push(...last)
      liveRef.current?.setAttribute('d', '')
      addStrokeHere(p)
    } else if (active.kind === 'erase') {
      setErasing(new Set())
      erase(active.hits)
    } else if (active.kind === 'place') {
      addStampHere(active.x, active.y)
    } else if (active.kind === 'drag') {
      setDragged(null)
      if (active.moved && active.at) changeStamp(active.id, { x: active.at.x, y: active.at.y })
    }
  }

  const cancel = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId)
    pinch.current = null
    gesture.current = null
    liveRef.current?.setAttribute('d', '')
    setErasing(new Set())
    setDragged(null)
  }

  const key = (event: ReactKeyboardEvent) => {
    if (!editable) return
    const target = event.target as HTMLElement
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key.toLowerCase() === 'z' && !typing) {
      event.preventDefault()
      history(!event.shiftKey)
    } else if (mod && event.key.toLowerCase() === 'y' && !typing) {
      event.preventDefault()
      history(false)
    } else if (event.key === ' ' && !typing) {
      event.preventDefault()
      space.current = true
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && tool === 'select' && selected && !typing) {
      event.preventDefault()
      erase(new Set([selected]))
    }
  }

  // ——— Own stamps ———

  const load = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    const refused: string[] = []
    let added: CustomStamp | null = null
    for (const file of files) {
      const stamp = await addCustomStamp(file.name.replace(/\.svg$/i, ''), await file.text())
      if (stamp) added = stamp
      else refused.push(file.name)
    }
    setMessage(refused.length ? `Keine verwendbare Form in: ${refused.join(', ')}` : '')
    if (added) setChosen(`custom:${added.id}`)
    onChanged()
  }

  const cursor = !editable || tool === 'hand' ? 'grab' : tool

  return (
    <div ref={wrapRef} className="sketch" tabIndex={-1} onKeyDown={key} onKeyUp={(event) => event.key === ' ' && (space.current = false)}>
      {editable && (
        <div className="sketch-tools" role="toolbar" aria-label="Werkzeuge">
          <span className="sketch-group">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                className="ghost"
                aria-pressed={tool === item.id}
                title={item.title}
                onClick={() => {
                  setTool(item.id)
                  // A selection is only kept (and Entf only acts) while it is shown.
                  if (item.id !== 'select') setSelected(null)
                }}
              >
                {item.label}
              </button>
            ))}
          </span>
          <span className="sketch-group" aria-label="Stiftstärke">
            {WIDTHS.map((item) => (
              <button key={item.level} className="ghost sketch-width" aria-label={item.label} title={item.label} aria-pressed={width === item.level} onClick={() => setWidth(item.level)}>
                <span style={{ height: STROKE_WIDTHS[item.level] + 1 }} aria-hidden="true" />
              </button>
            ))}
          </span>
          <span className="sketch-group" aria-label="Farbe">
            {SKETCH_COLORS.map((item) => (
              <button
                key={item.value}
                className="sketch-color"
                aria-label={`Farbe ${item.name}`}
                title={item.name}
                aria-pressed={color === item.value}
                style={{ background: item.value }}
                onClick={() => {
                  setColor(item.value)
                  if (tool === 'select' && selected) changeStamp(selected, { color: item.value })
                }}
              />
            ))}
          </span>
          <span className="sketch-group">
            <button className="ghost" title="Rückgängig (Strg+Z)" disabled={!undo.current.length && !inflight.current} onClick={() => history(true)}>
              Rückgängig
            </button>
            <button className="ghost" title="Wiederholen (Strg+Y)" disabled={!redo.current.length && !inflight.current} onClick={() => history(false)}>
              Wiederholen
            </button>
            <button className="ghost" title="Alles ins Bild holen" onClick={fit}>
              Alles zeigen
            </button>
          </span>
        </div>
      )}

      <div className="sketch-stage">
        <svg
          ref={svgRef}
          className={`sketch-canvas sketch-cursor-${cursor}`}
          role="group"
          aria-label={`Skizze ${local.name}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
        >
          <g className="sketch-world" transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            <Strokes strokes={local.strokes} hidden={erasing} />
            <path ref={liveRef} className="sketch-stroke sketch-live" d="" stroke={color} strokeWidth={STROKE_WIDTHS[width]} />
            {shownStamps.map((stamp) => {
              const edge = STAMP_SIZES[stamp.size]
              const label = stamp.entryId ? names.get(stamp.entryId) : undefined
              return (
                <g key={stamp.id} className={`sketch-stamp${stamp.entryId ? ' linked' : ''}`} transform={`translate(${stamp.x} ${stamp.y})`} style={{ color: stamp.color }}>
                  <StampShape stamp={stamp.stamp} size={edge} prepared={prepared.get(stamp.stamp)} />
                  {stamp.id === selected && tool === 'select' && <rect className="sketch-stamp-selected" x={-edge / 2 - 4} y={-edge / 2 - 4} width={edge + 8} height={edge + 8} rx={6} />}
                  {label && (
                    <text className="sketch-stamp-label" y={edge / 2 + 12} textAnchor="middle">
                      {label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
        {!local.strokes.length && !local.stamps.length && (
          <p className="sketch-empty muted">{editable ? 'Mit dem Stift zeichnen, mit Stempeln Orte setzen.' : 'Diese Skizze ist noch leer.'}</p>
        )}
        {/* Laid over the top of the canvas, so the drawing does not jump when they open or close. */}
        <div className="sketch-overlays">
          {editable && tool === 'stamp' && (
            <div className="sketch-palette" aria-label="Stempel">
              {BUILTIN_STAMPS.map((stamp) => (
                <button key={stamp.id} className="ghost sketch-stamp-choice" aria-label={stamp.name} title={stamp.name} aria-pressed={chosen === stamp.id} onClick={() => setChosen(stamp.id)}>
                  <svg viewBox={BUILTIN_VIEWBOX} width="22" height="22" aria-hidden="true">
                    <path d={stamp.path} fill="currentColor" />
                  </svg>
                </button>
              ))}
              {stamps.map((stamp) => (
                <button key={stamp.id} className="ghost sketch-stamp-choice" aria-label={stamp.name} title={stamp.name} aria-pressed={chosen === `custom:${stamp.id}`} onClick={() => setChosen(`custom:${stamp.id}`)}>
                  <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">
                    <StampShape stamp={`custom:${stamp.id}`} size={22} prepared={prepared.get(`custom:${stamp.id}`)} />
                  </svg>
                </button>
              ))}
              <label className="ghost sketch-load" title="SVG-Dateien als eigene Stempel laden (gelten für alle Bücher)">
                Eigene Stempel laden …
                <input type="file" accept=".svg,image/svg+xml" multiple onChange={(event) => void load(event)} />
              </label>
              {stamps.length > 0 && (
                <button className="ghost" aria-expanded={manage} onClick={() => setManage((open) => !open)}>
                  Eigene verwalten
                </button>
              )}
              {manage && (
                <ul className="sketch-own" aria-label="Eigene Stempel">
                  {stamps.map((stamp) => (
                    <li key={stamp.id}>
                      <input
                        aria-label={`Name von Stempel „${stamp.name}“`}
                        defaultValue={stamp.name}
                        onBlur={(event) => void renameCustomStamp(stamp.id, event.target.value).then(onChanged)}
                        onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
                      />
                      <button className="ghost danger" aria-label={`Stempel „${stamp.name}“ löschen`} onClick={() => setRemoving(stamp)}>
                        Löschen
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {editable && tool === 'select' && selectedStamp && (
            <div className="sketch-selection" aria-label="Ausgewählter Stempel">
              <span className="sketch-group" aria-label="Größe">
                {SIZES.map((item) => (
                  <button key={item.level} className="ghost" aria-label={`Größe ${item.label}`} aria-pressed={selectedStamp.size === item.level} onClick={() => changeStamp(selectedStamp.id, { size: item.level })}>
                    {item.label}
                  </button>
                ))}
              </span>
              <select aria-label="Mit Wiki-Eintrag verknüpfen" value={selectedStamp.entryId ?? ''} onChange={(event) => changeStamp(selectedStamp.id, { entryId: event.target.value || null })}>
                <option value="">Mit Wiki-Eintrag verknüpfen …</option>
                {sortedEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
              {selectedStamp.entryId && (
                <button className="ghost" onClick={() => changeStamp(selectedStamp.id, { entryId: null })}>
                  Lösen
                </button>
              )}
              <button className="ghost danger" onClick={() => erase(new Set([selectedStamp.id]))}>
                Löschen
              </button>
            </div>
          )}

          {message && (
            <p className="sketch-message muted" role="status">
              {message}
            </p>
          )}
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          message={`Stempel „${removing.name}“ löschen?`}
          detail="Er verschwindet aus der Auswahl in allen Büchern. Schon gesetzte Stempel bleiben als graue Fläche stehen."
          confirmLabel="Löschen"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id
            setRemoving(null)
            void deleteCustomStamp(id).then(onChanged)
          }}
        />
      )}
    </div>
  )
}
