import { useZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../lib/zoom'
import type { ZoomArea } from '../types'

export function ZoomControl({ area }: { area: ZoomArea }) {
  const [zoom, setZoom] = useZoom(area)
  return (
    <div className="zoom-control" role="group" aria-label="Zoom">
      <button
        className="ghost"
        aria-label="Verkleinern"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => setZoom(zoom - ZOOM_STEP)}
      >
        −
      </button>
      <button className="ghost zoom-value" title="Zoom zurücksetzen" onClick={() => setZoom(100)}>
        {zoom} %
      </button>
      <button
        className="ghost"
        aria-label="Vergrößern"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => setZoom(zoom + ZOOM_STEP)}
      >
        +
      </button>
    </div>
  )
}
