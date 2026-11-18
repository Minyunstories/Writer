import { useEffect, useState } from 'react'
import { CHANGED_EVENT, SYNCED_EVENT } from '../storage/connection'
import { getCollection } from '../storage/collection'
import type { Collection } from '../types'

/** The collection, kept current after changes here and after sync runs. */
export function useCollection(): Collection {
  const [collection, setCollection] = useState<Collection>({ items: [] })
  useEffect(() => {
    let alive = true
    const load = () =>
      void getCollection().then(
        (loaded) => alive && setCollection(loaded),
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
  return collection
}
