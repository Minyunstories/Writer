import { useEffect, useState } from 'react'
import './update.css'

type Apply = () => void

let waiting: Apply | null = null
const listeners = new Set<() => void>()

/** Called when a new version of the app has been downloaded and waits to be used. */
export function announceUpdate(apply: Apply): void {
  waiting = apply
  for (const listener of listeners) listener()
}

/**
 * Offers a new app version. It is never applied on its own, so a reload
 * cannot interrupt writing.
 */
export function UpdateNotice() {
  const [apply, setApply] = useState<Apply | null>(() => waiting)

  useEffect(() => {
    const onUpdate = () => setApply(() => waiting)
    listeners.add(onUpdate)
    onUpdate()
    return () => void listeners.delete(onUpdate)
  }, [])

  if (!apply) return null
  return (
    <div className="update-notice" role="status">
      <span>Eine neue Version der App ist bereit.</span>
      <button className="primary" onClick={apply}>
        Jetzt aktualisieren
      </button>
      <button
        className="ghost"
        onClick={() => {
          waiting = null
          setApply(null)
        }}
      >
        Später
      </button>
    </div>
  )
}
