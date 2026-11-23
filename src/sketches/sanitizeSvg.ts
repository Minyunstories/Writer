const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_LENGTH = 100_000
const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])
const ELEMENTS = new Set(['g', ...SHAPES])
const ATTRIBUTES = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points', 'transform',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule',
  'opacity', 'fill-opacity', 'stroke-opacity',
])
const COLOURS = new Set(['fill', 'stroke'])
/** What the root <svg> may pass on to its shapes (icon sets put colour and line style there). */
const INHERITED = new Set(['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity'])

/** A safe value for a kept attribute, or null to drop it. Colours become the pen colour. */
function clean(name: string, value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || /url\s*\(|javascript:|expression|[<>]/i.test(trimmed)) return null
  if (COLOURS.has(name)) return trimmed.toLowerCase() === 'none' ? 'none' : 'currentColor'
  return trimmed
}

/** Style declarations of kept properties, as attributes. */
function fromStyle(style: string | null): [string, string][] {
  if (!style) return []
  return style
    .split(';')
    .map((part) => part.split(':').map((piece) => piece.trim()))
    .filter((pair): pair is [string, string] => pair.length === 2 && ATTRIBUTES.has(pair[0].toLowerCase()))
    .map(([name, value]) => [name.toLowerCase(), value])
}

/**
 * An own stamp, made safe: only simple shapes, no scripts, links, pictures, styles or references; every colour
 * becomes the pen colour. `svg` is the file to keep (cleaning it again gives the same text), `inner` what to draw
 * inside an <svg viewBox> on the page. Null when the file is no usable SVG.
 */
export function sanitizeSvg(text: string): { svg: string; viewBox: string; inner: string } | null {
  if (text.length > MAX_LENGTH) return null
  let source: Document
  try {
    source = new DOMParser().parseFromString(text, 'image/svg+xml')
  } catch {
    return null
  }
  const root = source.documentElement
  if (!root || root.localName !== 'svg' || source.getElementsByTagName('parsererror').length) return null
  let viewBox = (root.getAttribute('viewBox') ?? '').trim().replace(/[\s,]+/g, ' ')
  if (!/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(viewBox)) {
    const width = parseFloat(root.getAttribute('width') ?? '')
    const height = parseFloat(root.getAttribute('height') ?? '')
    if (!(width > 0 && height > 0)) return null
    viewBox = `0 0 ${width} ${height}`
  }

  const target = document.implementation.createDocument(SVG_NS, 'svg', null)
  const out = target.documentElement
  out.setAttribute('viewBox', viewBox)
  const attributesOf = (element: Element): [string, string][] => [
    ...Array.from(element.attributes).map((attribute): [string, string] => [attribute.name.toLowerCase(), attribute.value]),
    ...fromStyle(element.getAttribute('style')),
  ]
  const keep = (from: [string, string][], to: Element, allowed: Set<string>) => {
    for (const [attribute, value] of from) {
      if (!allowed.has(attribute)) continue
      const safe = clean(attribute, value)
      if (safe !== null) to.setAttribute(attribute, safe)
    }
  }
  let drawable = false
  const copy = (from: Element, to: Element) => {
    for (const child of Array.from(from.children)) {
      const name = child.localName
      if (!ELEMENTS.has(name) || (child.namespaceURI && child.namespaceURI !== SVG_NS)) continue
      const element = target.createElementNS(SVG_NS, name)
      keep(attributesOf(child), element, ATTRIBUTES)
      if (SHAPES.has(name)) drawable = true
      copy(child, element)
      to.appendChild(element)
    }
  }
  // Icon sets put colour and line style on the root; without a fill there, shapes take the pen colour instead
  // of SVG's black. Kept on the root (so cleaning twice gives the same text) and put around the inside for drawing.
  out.setAttribute('fill', 'currentColor')
  keep(attributesOf(root), out, INHERITED)
  copy(root, out)
  if (!drawable) return null
  const group = target.createElementNS(SVG_NS, 'g')
  for (const name of out.getAttributeNames()) if (name !== 'viewBox') group.setAttribute(name, out.getAttribute(name)!)
  for (const child of Array.from(out.childNodes)) group.appendChild(child.cloneNode(true))
  const serializer = new XMLSerializer()
  // The group serialised on its own carries the namespace; inside an <svg> on the page it is not needed.
  const inner = serializer.serializeToString(group).replace(` xmlns="${SVG_NS}"`, '')
  return { svg: serializer.serializeToString(out), viewBox, inner }
}
