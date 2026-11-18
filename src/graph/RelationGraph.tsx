import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getImage } from '../storage/wiki'
import { clearGraph, placeInGraph } from '../storage/relations'
import type { Book, WikiEntry, WikiFolder } from '../types'
import { folderPaths } from '../wiki/WikiEntryEditor'
import { layoutGraph, type Point } from './layout'
import './graph.css'

interface Props {
  book: Pick<Book, 'id' | 'relations' | 'graph' | 'wikiStars'>
  entries: WikiEntry[]
  folders: WikiFolder[]
  onOpenEntry: (entryId: string) => void
  onChanged?: () => void
}

const COLORS = ['#d58d62', '#7aa7e0', '#7fae7a', '#c98bc4', '#d9a84e', '#6fb8b0', '#e07a6a', '#a59bd9']
const RADIUS = 26
const STAR_RADIUS = 34
const TAP = 4

/** Object URLs of the entries' portraits, released when no longer needed. */
function usePortraits(entries: WikiEntry[]): Map<string, string> {
  const [urls, setUrls] = useState(new Map<string, string>())
  const key = entries.map((entry) => `${entry.id}:${entry.imageIds[0] ?? ''}`).join('|')
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    let cancelled = false
    const created: string[] = []
    void Promise.all(
      entries
        .filter((entry) => entry.imageIds[0])
        .map(async (entry) => {
          const image = await getImage(entry.imageIds[0])
          if (!image) return null
          const url = URL.createObjectURL(new Blob([image.data], { type: image.type }))
          created.push(url)
          return [entry.id, url] as const
        }),
    ).then((pairs) => {
      if (!cancelled) setUrls(new Map(pairs.filter((pair): pair is readonly [string, string] => pair !== null)))
    })
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
    }
    // The key covers what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return urls
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')

/** Who is what to whom: entries as circles, relationships as labelled lines. */
export function RelationGraph({ book, entries, folders, onOpenEntry, onChanged }: Props) {
  const types = book.relations?.types ?? []
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [folder, setFolder] = useState('')
  const [hover, setHover] = useState<string | null>(null)
  const [dragged, setDragged] = useState<Record<string, Point>>({})
  const [view, setView] = useState<{ x: number; y: number; scale: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<{ kind: 'node' | 'pan'; id?: string; start: Point; origin: Point; moved: boolean } | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ distance: number; scale: number } | null>(null)

  // Folder filter: the chosen folder and everything below it.
  const inFolder = useMemo(() => {
    if (!folder) return () => true
    const within = new Set([folder])
    let grew = true
    while (grew) {
      grew = false
      for (const candidate of folders)
        if (candidate.parentId && within.has(candidate.parentId) && !within.has(candidate.id)) {
          within.add(candidate.id)
          grew = true
        }
    }
    return (entry: WikiEntry) => entry.folderId !== null && within.has(entry.folderId)
  }, [folder, folders])

  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])
  const colorOf = useMemo(() => new Map(types.map((type, index) => [type.id, COLORS[index % COLORS.length]])), [types])
  const typeOf = useMemo(() => new Map(types.map((type) => [type.id, type])), [types])
  const edges = useMemo(
    () =>
      (book.relations?.relations ?? []).filter((relation) => {
        const from = byId.get(relation.from)
        const to = byId.get(relation.to)
        return from && to && typeOf.has(relation.typeId) && !hidden.has(relation.typeId) && inFolder(from) && inFolder(to)
      }),
    [book.relations, byId, typeOf, hidden, inFolder],
  )
  const nodeIds = useMemo(() => {
    const ids = new Set(edges.flatMap((edge) => [edge.from, edge.to]))
    return entries.filter((entry) => ids.has(entry.id)).map((entry) => entry.id)
  }, [edges, entries])
  const lonely = entries.filter((entry) => inFolder(entry) && !nodeIds.includes(entry.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'))

  const placed = book.graph ?? {}
  const layout = useMemo(
    () =>
      layoutGraph(
        nodeIds,
        edges.map((edge) => [edge.from, edge.to]),
        Object.fromEntries(nodeIds.filter((id) => placed[id]).map((id) => [id, placed[id]])),
      ),
    // Placements are part of the key through JSON.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeIds.join('|'), edges.map((edge) => `${edge.from}>${edge.to}`).join('|'), JSON.stringify(placed)],
  )
  const position = (id: string): Point => dragged[id] ?? layout[id]
  const layoutRef = useRef(layout)
  layoutRef.current = Object.fromEntries(nodeIds.map((id) => [id, position(id)]))
  const portraits = usePortraits(nodeIds.map((id) => byId.get(id)!))
  const stars = new Set(book.wikiStars ?? [])

  // Fit everything into view the first time (and when the set of entries changes).
  const fitKey = nodeIds.join('|')
  const fit = () => {
    const svg = svgRef.current
    const width = svg?.clientWidth || 800
    const height = svg?.clientHeight || 520
    if (nodeIds.length === 0) return setView({ x: width / 2, y: height / 2, scale: 1 })
    const layout = { ...layoutRef.current }
    const xs = nodeIds.map((id) => layout[id].x)
    const ys = nodeIds.map((id) => layout[id].y)
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const scale = Math.min(1, width / (maxX - minX + 220), height / (maxY - minY + 180))
    setView({ scale, x: width / 2 - ((minX + maxX) / 2) * scale, y: height / 2 - ((minY + maxY) / 2) * scale })
  }
  const fitRef = useRef(fit)
  fitRef.current = fit
  useEffect(() => {
    fitRef.current()
  }, [fitKey])
  // When the space changes (a panel opens beside it), everything is fitted in again.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    let last = svg.clientWidth
    const observer = new ResizeObserver(() => {
      if (Math.abs(svg.clientWidth - last) < 40) return
      last = svg.clientWidth
      fitRef.current()
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  const neighbours = useMemo(() => {
    if (!hover) return null
    const near = new Set([hover])
    for (const edge of edges) {
      if (edge.from === hover) near.add(edge.to)
      if (edge.to === hover) near.add(edge.from)
    }
    return near
  }, [hover, edges])

  const current = view ?? { x: 400, y: 260, scale: 1 }
  const down = (event: ReactPointerEvent, id?: string) => {
    event.stopPropagation()
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: current.scale }
      gesture.current = null
      return
    }
    gesture.current = {
      kind: id ? 'node' : 'pan',
      id,
      start: { x: event.clientX, y: event.clientY },
      origin: id ? position(id) : { x: current.x, y: current.y },
      moved: false,
    }
  }

  const move = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const scale = Math.min(3, Math.max(0.2, (pinch.current.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.distance))
      setView({ ...current, scale })
      return
    }
    const active = gesture.current
    if (!active) return
    const dx = event.clientX - active.start.x
    const dy = event.clientY - active.start.y
    if (!active.moved && Math.hypot(dx, dy) < TAP) return
    active.moved = true
    if (active.kind === 'node' && active.id) setDragged((all) => ({ ...all, [active.id!]: { x: active.origin.x + dx / current.scale, y: active.origin.y + dy / current.scale } }))
    else setView({ ...current, x: active.origin.x + dx, y: active.origin.y + dy })
  }

  const up = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const active = gesture.current
    gesture.current = null
    if (!active || active.kind !== 'node' || !active.id) return
    if (!active.moved) return onOpenEntry(active.id)
    const point = dragged[active.id] ?? position(active.id)
    // Everything on screen keeps its place from now on, so nothing else moves.
    const all = Object.fromEntries(nodeIds.map((id) => [id, id === active.id ? point : position(id)]))
    void placeInGraph(book.id, all).then(() => onChanged?.())
  }

  const wheel = (event: React.WheelEvent) => {
    event.preventDefault()
    const box = svgRef.current?.getBoundingClientRect()
    const cx = event.clientX - (box?.left ?? 0)
    const cy = event.clientY - (box?.top ?? 0)
    const scale = Math.min(3, Math.max(0.2, current.scale * Math.exp(-event.deltaY * 0.0015)))
    const factor = scale / current.scale
    setView({ scale, x: cx - (cx - current.x) * factor, y: cy - (cy - current.y) * factor })
  }

  // Several relationships between the same two: curves side by side.
  const pairIndex = new Map<string, number>()
  const shaped = edges.map((edge) => {
    const pair = [edge.from, edge.to].sort().join('|')
    const index = pairIndex.get(pair) ?? 0
    pairIndex.set(pair, index + 1)
    return { edge, bend: index === 0 ? 0 : (index % 2 ? 1 : -1) * Math.ceil(index / 2) * 34 }
  })

  const paths = folderPaths(folders)

  return (
    <div className="relation-graph">
      <div className="relation-graph-tools">
        <label>
          <span className="muted">Ordner</span>
          <select aria-label="Ordner" value={folder} onChange={(event) => setFolder(event.target.value)}>
            <option value="">Alle</option>
            {paths.map((path) => (
              <option key={path.id} value={path.id}>
                {path.path}
              </option>
            ))}
          </select>
        </label>
        <span className="relation-graph-kinds">
          {types.map((type) => (
            <button
              key={type.id}
              className="relation-graph-kind"
              aria-pressed={!hidden.has(type.id)}
              title={type.backward ? `${type.forward} / ${type.backward}` : type.forward}
              onClick={() =>
                setHidden((all) => {
                  const next = new Set(all)
                  if (next.has(type.id)) next.delete(type.id)
                  else next.add(type.id)
                  return next
                })
              }
            >
              <span className="relation-graph-swatch" style={{ background: colorOf.get(type.id) }} aria-hidden="true" />
              {type.forward}
            </button>
          ))}
        </span>
        <button className="ghost" title="Alle Figuren ins Bild holen" onClick={fit}>
          Alles zeigen
        </button>
        {book.graph && (
          <button
            className="ghost"
            title="Alle Figuren wieder von selbst anordnen"
            onClick={() => {
              setDragged({})
              void clearGraph(book.id).then(() => onChanged?.())
            }}
          >
            Neu anordnen
          </button>
        )}
      </div>

      {nodeIds.length === 0 ? (
        <p className="muted relation-graph-empty">
          Noch keine Beziehungen{folder || hidden.size ? ' in dieser Auswahl' : ''}. Lege sie in einem Wiki-Eintrag unter „Beziehungen“ an.
        </p>
      ) : null}
      <svg
        ref={svgRef}
        className="relation-graph-canvas"
        role="group"
        aria-label="Beziehungsnetz"
        onPointerDown={(event) => down(event)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={wheel}
        style={nodeIds.length === 0 ? { display: 'none' } : undefined}
      >
        <defs>
          {nodeIds.map((id) => (
            <clipPath key={id} id={`portrait-${id}`}>
              <circle r={stars.has(id) ? STAR_RADIUS : RADIUS} />
            </clipPath>
          ))}
          {types.map((type) => (
            <marker key={type.id} id={`arrow-${type.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={colorOf.get(type.id)} />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${current.x} ${current.y}) scale(${current.scale})`}>
          {shaped.map(({ edge, bend }) => {
            const type = typeOf.get(edge.typeId)!
            const a = position(edge.from)
            const b = position(edge.to)
            const dx = b.x - a.x
            const dy = b.y - a.y
            const length = Math.max(1, Math.hypot(dx, dy))
            const ra = stars.has(edge.from) ? STAR_RADIUS : RADIUS
            const rb = stars.has(edge.to) ? STAR_RADIUS : RADIUS
            const start = { x: a.x + (dx / length) * ra, y: a.y + (dy / length) * ra }
            const end = { x: b.x - (dx / length) * (rb + 3), y: b.y - (dy / length) * (rb + 3) }
            const control = { x: (a.x + b.x) / 2 - (dy / length) * bend * 2, y: (a.y + b.y) / 2 + (dx / length) * bend * 2 }
            const middle = { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 }
            const faded = neighbours && !(neighbours.has(edge.from) && neighbours.has(edge.to) && (edge.from === hover || edge.to === hover))
            const color = colorOf.get(edge.typeId)
            return (
              <g key={edge.id} className={faded ? 'relation-graph-edge faded' : 'relation-graph-edge'}>
                <path
                  d={`M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`}
                  stroke={color}
                  fill="none"
                  strokeWidth={2}
                  markerEnd={type.backward ? `url(#arrow-${type.id})` : undefined}
                />
                <text x={middle.x} y={middle.y - 6} textAnchor="middle" className="relation-graph-label" fill={color}>
                  {type.backward ? `${type.forward} →` : type.forward}
                </text>
              </g>
            )
          })}
          {nodeIds.map((id) => {
            const entry = byId.get(id)!
            const point = position(id)
            const radius = stars.has(id) ? STAR_RADIUS : RADIUS
            const url = portraits.get(id)
            const faded = neighbours && !neighbours.has(id)
            return (
              <g
                key={id}
                className={faded ? 'relation-graph-node faded' : 'relation-graph-node'}
                transform={`translate(${point.x} ${point.y})`}
                role="button"
                tabIndex={0}
                aria-label={entry.name}
                onPointerDown={(event) => down(event, id)}
                onPointerUp={up}
                onPointerEnter={() => setHover(id)}
                onPointerLeave={() => setHover((current) => (current === id ? null : current))}
                onFocus={() => setHover(id)}
                onBlur={() => setHover(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpenEntry(id)
                  }
                }}
              >
                <circle r={radius + 3} className="relation-graph-ring" />
                {url ? (
                  <image href={url} x={-radius} y={-radius} width={radius * 2} height={radius * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#portrait-${id})`} />
                ) : (
                  <>
                    <circle r={radius} className="relation-graph-disc" />
                    <text textAnchor="middle" dy="0.35em" className="relation-graph-initials">
                      {initials(entry.name)}
                    </text>
                  </>
                )}
                <text y={radius + 18} textAnchor="middle" className="relation-graph-name">
                  {entry.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {lonely.length > 0 && (
        <div className="relation-graph-lonely">
          <span className="muted">Ohne Beziehung</span>
          <ul aria-label="Ohne Beziehung">
            {lonely.map((entry) => (
              <li key={entry.id}>
                <button className="ghost" onClick={() => onOpenEntry(entry.id)}>
                  {entry.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted relation-graph-hint">Figuren ziehen zum Anordnen · Hintergrund ziehen zum Verschieben · Mausrad oder zwei Finger zum Zoomen</p>
    </div>
  )
}
