import { SketchesView, type SketchesViewProps } from './SketchesView'

/** Sketches on the wiki home: lots of room for working on them. */
export function SketchesPage(props: SketchesViewProps) {
  return (
    <div className="wiki-sketches-page">
      <SketchesView {...props} />
    </div>
  )
}
