import { ICONS, type IconName } from './icons'

/** A toolbar icon in the current text colour; decorative, the button keeps its own name. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon-svg" viewBox="0 -960 960 960" width="18" height="18" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  )
}
