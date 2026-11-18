export interface Point {
  x: number
  y: number
}

const ITERATIONS = 300
const SPRING = 90
const REPULSION = 30000
/** The forces work at a small scale; the result is spread by this much, so names and labels have room. */
const SPREAD = 1.8

/**
 * Places entries so that related ones sit close together: they repel each other and their
 * relationships pull like springs. Placed entries stay put. The same input always gives the
 * same picture, so nothing jumps around between visits.
 */
export function layoutGraph(nodes: string[], edges: [string, string][], placed: Record<string, Point>): Record<string, Point> {
  const ids = [...nodes]
  const index = new Map(ids.map((id, i) => [id, i]))
  const free = ids.map((id) => !placed[id])
  const radius = 60 + ids.length * 18
  // Start on a circle (golden angle), in the given order: deterministic.
  const inner = (point: Point) => ({ x: point.x / SPREAD, y: point.y / SPREAD })
  const pos = ids.map((id, i) => (placed[id] ? inner(placed[id]) : null) ?? { x: Math.cos(i * 2.39996) * radius * Math.sqrt((i + 1) / ids.length), y: Math.sin(i * 2.39996) * radius * Math.sqrt((i + 1) / ids.length) })
  const links = edges.flatMap(([a, b]) => (index.has(a) && index.has(b) && a !== b ? [[index.get(a)!, index.get(b)!] as const] : []))

  for (let step = 0; step < ITERATIONS; step++) {
    const cool = 1 - step / ITERATIONS
    const force = pos.map(() => ({ x: 0, y: 0 }))
    for (let i = 0; i < pos.length; i++)
      for (let j = i + 1; j < pos.length; j++) {
        let dx = pos[i].x - pos[j].x
        let dy = pos[i].y - pos[j].y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) {
          dx = (i - j) * 0.5
          dy = 0.5
          d2 = dx * dx + dy * dy
        }
        const push = REPULSION / d2
        const d = Math.sqrt(d2)
        force[i].x += (dx / d) * push
        force[i].y += (dy / d) * push
        force[j].x -= (dx / d) * push
        force[j].y -= (dy / d) * push
      }
    for (const [a, b] of links) {
      const dx = pos[b].x - pos[a].x
      const dy = pos[b].y - pos[a].y
      const d = Math.max(1, Math.hypot(dx, dy))
      const pull = (d - SPRING) * 0.4
      force[a].x += (dx / d) * pull
      force[a].y += (dy / d) * pull
      force[b].x -= (dx / d) * pull
      force[b].y -= (dy / d) * pull
    }
    for (let i = 0; i < pos.length; i++) {
      if (!free[i]) continue
      // A gentle pull to the middle keeps separate groups on screen.
      force[i].x -= pos[i].x * 0.004
      force[i].y -= pos[i].y * 0.004
      const limit = 30 * cool + 1
      const length = Math.hypot(force[i].x, force[i].y)
      const scale = length > limit ? limit / length : 1
      pos[i] = { x: pos[i].x + force[i].x * scale, y: pos[i].y + force[i].y * scale }
    }
  }
  return Object.fromEntries(ids.map((id, i) => [id, free[i] ? { x: Math.round(pos[i].x * SPREAD), y: Math.round(pos[i].y * SPREAD) } : placed[id]]))
}
