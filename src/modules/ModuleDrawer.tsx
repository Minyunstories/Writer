import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { MODULES, type ModuleId } from './modules'
import './modules.css'

const STEP = 16

interface Props {
  modules: ModuleId[]
  tab: ModuleId
  onTab: (id: ModuleId) => void
  chapterTitle: string
  height: number
  onHeight: (height: number) => void
  onClose: () => void
  children: ReactNode
}

/** The drawer under the chapter that holds the book's modules, one tab each. */
export function ModuleDrawer({ modules, tab, onTab, chapterTitle, height, onHeight, onClose, children }: Props) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height
    const move = (moveEvent: globalThis.PointerEvent) => onHeight(startHeight - (moveEvent.clientY - startY))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') onHeight(height + STEP)
    else if (event.key === 'ArrowDown') onHeight(height - STEP)
    else return
    event.preventDefault()
  }
  const names = MODULES.filter((module) => modules.includes(module.id))

  return (
    <section className="module-drawer" aria-label="Module" style={{ '--drawer-height': `${height}px` } as CSSProperties}>
      <div
        className="module-drawer-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Höhe der Schublade"
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <header className="module-drawer-header">
        {names.length > 1 ? (
          <span className="panel-tabs" role="tablist" aria-label="Module">
            {names.map((module) => (
              <button key={module.id} role="tab" aria-selected={tab === module.id} onClick={() => onTab(module.id)}>
                {module.tab}
              </button>
            ))}
          </span>
        ) : (
          <span className="module-drawer-name">{names[0]?.tab}</span>
        )}
        <h2 className="module-drawer-chapter">Kapitel: {chapterTitle}</h2>
        <button type="button" className="ghost module-drawer-close" onClick={onClose}>
          Schließen
        </button>
      </header>
      <div className="module-drawer-body">{children}</div>
    </section>
  )
}
