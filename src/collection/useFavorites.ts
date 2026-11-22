import { useEffect, useState } from 'react'
import { CHANGED_EVENT, SYNCED_EVENT } from '../storage/connection'
import { getFavorites } from '../storage/favorites'
import type { Favorites } from '../types'

/** The favourites, kept current after changes here and after sync runs. */
export function useFavorites(): Favorites {
  const [favorites, setFavorites] = useState<Favorites>({ marks: [] })
  useEffect(() => {
    let alive = true
    const load = () =>
      void getFavorites().then(
        (loaded) => alive && setFavorites(loaded),
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
  return favorites
}
