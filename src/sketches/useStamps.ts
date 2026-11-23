import { useEffect, useState } from 'react'
import { CHANGED_EVENT, SYNCED_EVENT } from '../storage/connection'
import { listStamps } from '../storage/stamps'
import type { CustomStamp } from '../types'

/** Own stamps (all books), kept current after changes here and after sync runs. */
export function useStamps(): CustomStamp[] {
  const [stamps, setStamps] = useState<CustomStamp[]>([])
  useEffect(() => {
    let alive = true
    const load = () =>
      void listStamps().then(
        (loaded) => alive && setStamps((current) => (JSON.stringify(current) === JSON.stringify(loaded) ? current : loaded)),
        () => {},
      )
    load()
    window.addEventListener(CHANGED_EVENT, load)
    window.addEventListener(SYNCED_EVENT, load)
    return () => {
      alive = false
      window.removeEventListener(CHANGED_EVENT, load)
      window.removeEventListener(SYNCED_EVENT, load)
    }
  }, [])
  return stamps
}
